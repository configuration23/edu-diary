import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AccessScope } from '@edu-diary/domain';
import {
  createHomeworkRequestSchema,
  homeworkAssignmentSummarySchema,
  listHomeworkQuerySchema,
  listHomeworkResponseSchema,
  listSubmissionsResponseSchema,
  submitHomeworkRequestSchema,
  uploadFileResponseSchema,
  updateHomeworkRequestSchema,
  type HomeworkAssignmentSummaryDto,
} from '@edu-diary/contracts';

import { actorFromRequest } from '../../shared/actor';
import { AppError } from '../../shared/errors';
import { authOf } from '../../shared/guards';
import type { AuditService } from '../audit';
import type { LessonRecord } from '../schedule';
import { createAssignmentFileRepository } from './homework.files.repository';
import { createSubmissionFileRepository } from './homework.submission-files.repository';
import { createSubmissionRepository } from './homework.submissions.repository';
import { createSubmissionService } from './homework.submissions.service';
import { createFileService, type FileSink } from './homework.files.service';
import { createHomeworkRepository, type AssignmentWithContext } from './homework.repository';
import {
  createHomeworkService,
  type HomeworkDetail,
  type HomeworkViewer,
} from './homework.service';
import type { Database } from '../../shared/db/client';
import type { StorageAdapter } from '../storage';

/**
 * Верхняя граница размера при разборе запроса.
 *
 * Совпадает с максимально допустимой настройкой (50 МБ). Точный предел проверяет домен —
 * здесь мы лишь бережём память сервера от заведомо чрезмерных загрузок.
 */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Домашние задания: маршруты.
 *
 * Права проверяет сервис: правило «чужой урок — не твоё дело» должно действовать одинаково
 * в списке, правке и удалении. Маршруты отвечают за разбор запроса и форму ответа.
 *
 * Ученик получает задания **своей группы**: набор уроков определяет не он, а сервер по его
 * составу группы, поэтому подставить чужой идентификатор группы не получится.
 */

export interface HomeworkModuleDependencies {
  db: Database;
  audit: AuditService;
  /** Урок или 
ull, если его нет: сервис сам решает, отвечать 404 или отказать. */
  findLesson: (lessonId: string) => Promise<LessonRecord | null>;
  listLessonsForGroup: (studyGroupId: string, from: string, to: string) => Promise<LessonRecord[]>;
  /** Состав группы: от него зависит, сколько учеников должны сдать. */
  maxDurationDays: () => Promise<number>;
  /** Группы ученика и его представителей: ученик видит только их. */
  groupIdsOfViewer: (viewerUserId: string) => Promise<string[]>;
  /** Текущий адаптер хранилища: администратор может сменить его без перезапуска. */
  storageAdapter: () => Promise<StorageAdapter>;
  /** Предельный размер файла и белый список типов — из настроек. */
  storageLimits: () => Promise<{ maxFileMb: number; allowedExtensions: readonly string[] }>;
  /**
   * Можно ли выдать файл этому смотрящему.
   *
   * Проверка вынесена в приложение: она требует и урока, и состава группы, а модуль заданий
   * не должен знать про зачисления (ARCHITECTURE.md §3).
   */
  /**
   * Чьё это задание и чей это ученик.
   *
   * Проверка вынесена в приложение: она требует уроков и состава группы, а модуль заданий не
   * должен знать про зачисления. `null` означает «смотрящему это задание не положено» —
   * ответ в этом случае не отличается от «задание не найдено».
   */
  resolveStudentAccess: (input: {
    viewerUserId: string;
    /** Область права смотрящего: `all` — администратор, `assigned` — свой урок. */
    scope: AccessScope | undefined;
    assignmentId: string;
  }) => Promise<{
    assignment: AssignmentWithContext;
    /** Карточка ученика смотрящего: у представителя её нет — он только смотрит. */
    studentId: string | null;
  } | null>;
  /** Урок задания: нужен, чтобы проверить право преподавателя на список сдавших. */
  findAssignmentLesson: (assignmentId: string) => Promise<string | null>;
  mayReadFile: (input: {
    viewerUserId: string;
    /** Область права на проверку: `all` — администратор, иначе только свой урок. */
    scope: AccessScope | undefined;
    fileId: string;
  }) => Promise<boolean>;
}

function toSummary(
  detail: HomeworkDetail,
  lesson: { lessonDate: string } | null,
): HomeworkAssignmentSummaryDto {
  return homeworkAssignmentSummarySchema.parse({
    id: detail.assignment.id,
    lessonId: detail.assignment.lessonId,
    text: detail.assignment.text,
    dueOn: detail.assignment.dueOn,
    visibleUntil: detail.assignment.visibleUntil,
    files: detail.files,
    links: detail.links,
    createdAt: detail.assignment.createdAt.toISOString(),
    lessonDate: lesson?.lessonDate ?? detail.assignment.lessonDate,
    groupName: detail.assignment.groupName,
    subjectName: detail.assignment.subjectName,
    submittedCount: detail.submittedCount,
    studentCount: detail.studentCount,
  });
}

export function createHomeworkModule(dependencies: HomeworkModuleDependencies) {
  const { db, audit, findLesson, listLessonsForGroup, groupIdsOfViewer } = dependencies;

  const service = createHomeworkService({
    repository: createHomeworkRepository(db.orm),
    findLesson,
    maxDurationDays: dependencies.maxDurationDays,
  });

  const fileRepository = createAssignmentFileRepository(db.orm);

  const submissionRepository = createSubmissionRepository(db.orm);
  const submissionFileRepository = createSubmissionFileRepository(db.orm);
  const submissions = createSubmissionService({ repository: submissionRepository });

  const files = createFileService({
    adapter: dependencies.storageAdapter,
  });

  /**
   * Область права **проверяющего**.
   *
   * У ученика homework:write есть, но с областью own — это отправка решения, а не
   * проверка. Поэтому own здесь не считается: иначе ученик получил бы доступ к списку
   * сдавших и к чужим работам.
   */
  const staffScopeOf = (viewer: HomeworkViewer): AccessScope | undefined => {
    const review = viewer.permissions.get('homework:review');
    if (review === 'assigned' || review === 'all') return review;

    const write = viewer.permissions.get('homework:write');
    return write === 'assigned' || write === 'all' ? write : undefined;
  };

  /** Наличие права: область проверяет сервис там, где это важно. */
  const has = (viewer: HomeworkViewer, permission: string): boolean =>
    viewer.permissions.has(permission);

  const viewerOf = (request: Parameters<typeof authOf>[0]): HomeworkViewer => {
    const auth = authOf(request);
    return { userId: auth.userId, permissions: auth.permissions };
  };

  return async function homeworkModule(app: FastifyInstance): Promise<void> {
    /**
     * Приём вложений.
     *
     * Ограничение размера ставим и на разборе (`fileSize`), чтобы сервер не держал в памяти
     * лишнее, и в домене — по настройке. Два уровня не дублируют друг друга: первый бережёт
     * память, второй отвечает за правило.
     */
    await app.register(multipart, {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    });

    /**
     * Приём файла.
     *
     * Маршруты **разные**: материал задания прикладывает преподаватель, файл решения —
     * ученик, и это документы разного автора с разными таблицами. Один маршрут с признаком
     * в запросе оказался ненадёжным: при разборе multipart строка запроса читается не так,
     * как в обычном запросе, и файл уходил не в ту таблицу.
     */
    const receiveFile = async (
      request: FastifyRequest,
      reply: FastifyReply,
      repository: FileSink,
    ) => {
      const viewer = viewerOf(request);
      if (!has(viewer, 'homework:write')) {
        throw new AppError('FORBIDDEN', 'Недостаточно прав: homework:write');
      }

      const file = await request.file();
      if (file === undefined) throw new AppError('VALIDATION_FAILED', 'Файл не передан');

      const limits = await dependencies.storageLimits();
      const uploaded = await files.upload({
        fileName: file.filename,
        body: await file.toBuffer(),
        uploadedBy: viewer.userId,
        maxFileMb: limits.maxFileMb,
        allowedExtensions: limits.allowedExtensions,
        repository,
      });

      // 201: файл создан. Ответ содержит идентификатор, который потом привяжут к документу.
      reply.status(201);
      return uploadFileResponseSchema.parse(uploaded);
    };

    app.post('/homework/files', async (request, reply) =>
      receiveFile(request, reply, fileRepository),
    );

    /** Файл решения: та же проверка размера и типа, но метаданные идут в свою таблицу. */
    app.post('/homework/submission-files', async (request, reply) =>
      receiveFile(request, reply, submissionFileRepository),
    );

    /**
     * Выдача вложения.
     *
     * Файл отдаётся **только через API**: прямой ссылки на хранилище нет, и загруженное не
     * достать в обход прав. Чужой файл отвечает `404` — как несуществующий, чтобы разница не
     * выдавала чужое задание.
     */
    app.get('/homework/files/:fileId', async (request, reply) => {
      const { fileId } = request.params as { fileId: string };
      const viewer = viewerOf(request);

      const file = await fileRepository.findById(fileId);
      if (file === null) throw new AppError('NOT_FOUND', 'Файл не найден');

      const allowed = await dependencies.mayReadFile({
        viewerUserId: viewer.userId,
        scope: staffScopeOf(viewer),
        fileId,
      });

      if (!allowed) throw new AppError('NOT_FOUND', 'Файл не найден');

      const body = await files.read(file.storageKey);
      if (body === null) throw new AppError('NOT_FOUND', 'Файл не найден');

      return (
        reply
          .header('content-type', file.mimeType)
          /** Имя в `filename*`: пробелы и кириллица иначе ломают заголовок. */
          .header(
            'content-disposition',
            `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
          )
          .send(body)
      );
    });

    /**
     * Сдача решения.
     *
     * Состояние и отправка разделены: ученик сначала видит, сдано ли уже и какой срок, и
     * только потом отправляет. Одна попытка — проверяется на сервере, а не в интерфейсе:
     * повторное нажатие при медленной сети не должно создавать второе решение.
     */
    app.get('/homework/:assignmentId/submission', async (request) => {
      const { assignmentId } = request.params as { assignmentId: string };
      const viewer = viewerOf(request);

      const access = await dependencies.resolveStudentAccess({
        viewerUserId: viewer.userId,
        scope:
          viewer.permissions.get('homework:review') ?? viewer.permissions.get('homework:write'),
        assignmentId,
      });

      if (access === null) throw new AppError('NOT_FOUND', 'Задание не найдено');

      const own =
        access.studentId === null
          ? null
          : await submissions.findOwn({
              assignmentId,
              studentId: access.studentId,
              dueOn: access.assignment.dueOn,
            });

      return {
        own,
        dueOn: access.assignment.dueOn,
        /** Сдавать может только ученик, у которого есть карточка, и только один раз. */
        canSubmit: access.studentId !== null && own === null,
      };
    });

    app.post('/homework/:assignmentId/submission', async (request, reply) => {
      const { assignmentId } = request.params as { assignmentId: string };
      const body = submitHomeworkRequestSchema.parse(request.body);
      const viewer = viewerOf(request);

      const access = await dependencies.resolveStudentAccess({
        viewerUserId: viewer.userId,
        scope:
          viewer.permissions.get('homework:review') ?? viewer.permissions.get('homework:write'),
        assignmentId,
      });

      /**
       * Задание не своей группы, чужое задание и несуществующее отвечают одинаково: иначе по
       * разнице ответов можно было бы узнать о чужих заданиях.
       */
      if (access === null || access.studentId === null) {
        throw new AppError('NOT_FOUND', 'Задание не найдено');
      }

      const created = await submissions.submit({
        assignment: access.assignment,
        studentId: access.studentId,
        viewerUserId: viewer.userId,
        text: body.text,
        fileIds: body.fileIds,
      });

      await audit.record(
        {
          action: 'create',
          entityKind: 'homework_submission',
          entityId: created.id,
          after: { assignmentId },
        },
        actorFromRequest(request),
      );

      reply.status(201);
      return { id: created.id };
    });

    /** Список сдавших: для учителя урока и администратора. */
    app.get('/homework/:assignmentId/submissions', async (request) => {
      const { assignmentId } = request.params as { assignmentId: string };
      const viewer = viewerOf(request);

      /**
       * Список сдавших — **только проверяющим**. У ученика есть homework:write, но с
       * областью own: это отправка решения, а не проверка. Без этой проверки ученик
       * получал бы работы всего класса.
       */
      if (staffScopeOf(viewer) === undefined && !viewer.permissions.has('homework:review')) {
        throw new AppError('FORBIDDEN', 'Недостаточно прав: homework:review');
      }

      const assignment = await service.getForLesson({
        viewer,
        lessonId: (await dependencies.findAssignmentLesson(assignmentId)) ?? '',
      });

      if (assignment === null) throw new AppError('NOT_FOUND', 'Задание не найдено');

      const items = await submissions.list({ assignment: assignment.assignment });

      return listSubmissionsResponseSchema.parse({ items, total: items.length });
    });

    /** Задание урока: экран журнала. */
    app.get('/homework/lesson/:lessonId', async (request) => {
      const { lessonId } = request.params as { lessonId: string };
      const detail = await service.getForLesson({ viewer: viewerOf(request), lessonId });

      return { item: detail === null ? null : toSummary(detail, null) };
    });

    /** Задания на дату: ученик и представитель видят задания своих групп. */
    app.get('/homework', async (request) => {
      const query = listHomeworkQuerySchema.parse(request.query);
      const viewer = viewerOf(request);

      /**
       * Набор групп определяет сервер, а не клиент: у ученика это его группы (и группы его
       * детей), у администратора — указанная группа. Так подстановка чужого идентификатора
       * ничего не даёт.
       */
      const ownGroupIds = await groupIdsOfViewer(viewer.userId);
      const adminSeesAll = viewer.permissions.get('homework:read') === 'all';

      const targetGroups =
        query.studyGroupId === undefined
          ? ownGroupIds
          : adminSeesAll
            ? [query.studyGroupId]
            : ownGroupIds.filter((id) => id === query.studyGroupId);

      const onDate = query.onDate ?? new Date().toISOString().slice(0, 10);

      const items: HomeworkAssignmentSummaryDto[] = [];
      for (const studyGroupId of targetGroups) {
        const lessons = await listLessonsForGroup(studyGroupId, onDate, onDate);
        if (lessons.length === 0) continue;

        const details = await service.listVisible({
          viewer,
          studyGroupId,
          lessons: lessons.map((lesson) => ({
            lessonId: lesson.id,
            lessonDate: lesson.lessonDate,
          })),
          onDate,
        });

        for (const detail of details) {
          const lesson = lessons.find((item) => item.id === detail.assignment.lessonId) ?? null;
          items.push(toSummary(detail, lesson));
        }
      }

      return listHomeworkResponseSchema.parse({ items, total: items.length });
    });

    app.post('/homework', async (request, reply) => {
      const body = createHomeworkRequestSchema.parse(request.body);
      const viewer = viewerOf(request);

      const created = await service.createAssignment({
        viewer,
        lessonId: body.lessonId,
        text: body.text,
        dueOn: body.dueOn ?? null,
        visibleUntil: body.visibleUntil ?? null,
        links: body.links.map((link) => ({ url: link.url, title: link.title ?? null })),
        fileIds: body.fileIds,
      });

      await audit.record(
        {
          action: 'create',
          entityKind: 'homework_assignment',
          entityId: created.id,
          after: { lessonId: body.lessonId, dueOn: body.dueOn ?? null },
        },
        actorFromRequest(request),
      );

      reply.status(201);
      return { id: created.id };
    });

    app.patch('/homework/:assignmentId', async (request) => {
      const { assignmentId } = request.params as { assignmentId: string };
      const body = updateHomeworkRequestSchema.parse(request.body);
      const viewer = viewerOf(request);

      await service.updateAssignment({
        viewer,
        assignmentId,
        ...(body.text === undefined ? {} : { text: body.text }),
        ...(body.dueOn === undefined ? {} : { dueOn: body.dueOn }),
        ...(body.visibleUntil === undefined ? {} : { visibleUntil: body.visibleUntil }),
        ...(body.links === undefined
          ? {}
          : {
              links: body.links.map((link) => ({
                url: link.url,
                title: link.title ?? null,
              })),
            }),
        ...(body.fileIds === undefined ? {} : { fileIds: body.fileIds }),
      });

      await audit.record(
        { action: 'update', entityKind: 'homework_assignment', entityId: assignmentId },
        actorFromRequest(request),
      );

      return { ok: true };
    });

    app.delete('/homework/:assignmentId', async (request) => {
      const { assignmentId } = request.params as { assignmentId: string };

      await service.removeAssignment({ viewer: viewerOf(request), assignmentId });

      await audit.record(
        { action: 'delete', entityKind: 'homework_assignment', entityId: assignmentId },
        actorFromRequest(request),
      );

      return { ok: true };
    });
  };
}
