import multipart from '@fastify/multipart';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { buildUploadName } from '@edu-diary/domain';
import type { AccessScope } from '@edu-diary/domain';
import {
  createHomeworkRequestSchema,
  homeworkAssignmentSummarySchema,
  listHomeworkQuerySchema,
  listAssignmentSubmissionsResponseSchema,
  lessonHomeworkFlagsResponseSchema,
  lessonHomeworkResponseSchema,
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
  /** Урок или `null`, если его нет: сервис сам решает, отвечать `404` или отказать. */
  findLesson: (lessonId: string) => Promise<LessonRecord | null>;
  listLessonsForGroup: (studyGroupId: string, from: string, to: string) => Promise<LessonRecord[]>;
  /** Группы ученика и его представителей: ученик видит только их. */
  groupIdsOfViewer: (viewerUserId: string) => Promise<string[]>;
  /**
   * Состав группы **на дату**: таблица сданных работ строится по нему.
   *
   * Именно на дату урока-срока: проверяют тех, кто был в группе тогда, а не тех, кто в ней
   * сейчас — иначе состав «поехал» бы после каждого перевода.
   */
  studentsOfGroup: (
    studyGroupId: string,
    onDate: string,
  ) => Promise<{ studentId: string; studentName: string }[]>;
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

/**
 * Задание для ответа.
 *
 * Две даты, и обе нужны: lessonDate — **когда задали** (учитель видит «домашняя работа
 * от 8-го»), dueLessonDate — **когда сдавать** (ученик видит «сдать до 15-го»).
 */
function toSummary(detail: HomeworkDetail): HomeworkAssignmentSummaryDto {
  return homeworkAssignmentSummarySchema.parse({
    id: detail.assignment.id,
    lessonId: detail.assignment.lessonId,
    lessonDate: detail.assignment.lessonDate,
    dueLessonId: detail.assignment.dueLessonId,
    dueLessonDate: detail.assignment.dueLessonDate,
    text: detail.assignment.text,
    files: detail.files,
    links: detail.links,
    createdAt: detail.assignment.createdAt.toISOString(),
    groupName: detail.assignment.groupName,
    subjectName: detail.assignment.subjectName,
    submittedCount: detail.submittedCount,
    studentCount: detail.studentCount,
  });
}

export function createHomeworkModule(dependencies: HomeworkModuleDependencies) {
  const { db, audit, findLesson, listLessonsForGroup, groupIdsOfViewer } = dependencies;

  /** Один репозиторий заданий на весь модуль: сервис и список сдавших берут его отсюда. */
  const homeworkRepository = createHomeworkRepository(db.orm);

  const service = createHomeworkService({
    repository: homeworkRepository,
    findLesson,
    listLessonsForGroup,
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

      /**
       * Ранний отказ по заявленному размеру: тело ещё не читается. Иначе сервер принимал 20 МБ, чтобы
       * потом сообщить про лимит 10 МБ.
       */
      const declaredBytes = Number(request.headers['content-length'] ?? '0');
      if (Number.isFinite(declaredBytes) && declaredBytes > MAX_UPLOAD_BYTES) {
        throw new AppError('PAYLOAD_TOO_LARGE', 'Файл больше допустимого размера');
      }

      const file = await request.file();
      if (file === undefined) throw new AppError('VALIDATION_FAILED', 'Файл не передан');

      /**
       * Предмет берём из задания, если оно указано в запросе: имя файла должно быть понятным
       * («2026-10-19_uchenik-ivanov_matematika.pdf»), а не «IMG_0421».
       */
      const query = request.query as { assignmentId?: string };
      const assignment =
        typeof query.assignmentId === 'string' && query.assignmentId !== ''
          ? await homeworkRepository.findAssignment(query.assignmentId)
          : null;

      const limits = await dependencies.storageLimits();
      const uploaded = await files.upload({
        fileName: file.filename,
        displayName: buildUploadName({
          at: new Date(),
          login: authOf(request).username,
          subjectName: assignment?.subjectName ?? null,
          originalFileName: file.filename,
        }),
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
              dueLessonDate: access.assignment.dueLessonDate,
            });

      return {
        own,
        /** Урок-срок: по нему ученик видит, когда сдавать. */
        dueLessonId: access.assignment.dueLessonId,
        dueLessonDate: access.assignment.dueLessonDate,
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

    /**
     * Сданные работы: **таблица класса** по заданиям.
     *
     * Учителю нужна не россыпь сдавших, а таблица: напротив каждого ученика его ответ или
     * пометка «не сдал». Поэтому отдаём задания вместе с составом группы **на дату урока-срока**
     * — проверяют тех, кто был тогда, а не тех, кто в группе сейчас.
     */
    app.get('/homework/submissions', async (request) => {
      const query = listHomeworkQuerySchema.parse(request.query);
      const viewer = viewerOf(request);

      const ownGroupIds = await groupIdsOfViewer(viewer.userId);

      const today = new Date().toISOString().slice(0, 10);
      const from = query.from ?? today;
      const to = query.to ?? from;

      const scope = staffScopeOf(viewer);

      /**
       * Какую группу показывать.
       *
       * Администратор (`all`) — любую указанную, преподаватель (`assigned`) — тоже указанную:
       * у него нет «своих» групп в ученическом смысле, он выбирает их из своих назначений, а
       * работы всё равно ограничены его уроками в сервисе. Раньше здесь стоял фильтр по
       * ученическим группам, и запрос преподавателя всегда возвращал пусто — **именно поэтому
       * раздел «Сданные работы» ничего не показывал**.
       *
       * Ученику оставляем только его группы: это область `own`.
       */
      const requestedGroup = query.studyGroupId;
      const targetGroups =
        requestedGroup !== undefined
          ? scope === 'all' || scope === 'assigned'
            ? [requestedGroup]
            : ownGroupIds.filter((id) => id === requestedGroup)
          : ownGroupIds;

      console.log(
        'ПРОСЛЕЖИВАНИЕ: запрос',
        JSON.stringify(query),
        'группы',
        JSON.stringify(targetGroups),
      );

      const assignments: AssignmentWithContext[] = [];
      for (const studyGroupId of targetGroups) {
        const lessons = await listLessonsForGroup(studyGroupId, from, to);
        assignments.push(
          ...(
            await service.listDue({
              viewer,
              dueLessonIds: lessons.map((lesson) => lesson.id),
            })
          ).map((detail) => detail.assignment),
        );
      }

      const tables = await service.listSubmissionsTable({
        viewer,
        assignments,
        studentsOfGroup: dependencies.studentsOfGroup,
      });

      return listAssignmentSubmissionsResponseSchema.parse({
        items: tables.map((table) => {
          const submitted = table.rows.filter((row) => row.submission !== null).length;

          return {
            assignmentId: table.assignment.id,
            lessonDate: table.assignment.lessonDate,
            dueLessonDate: table.assignment.dueLessonDate,
            subjectName: table.assignment.subjectName,
            groupName: table.assignment.groupName,
            text: table.assignment.text,
            rows: table.rows,
            submittedCount: submitted,
            studentCount: table.rows.length,
          };
        }),
      });
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

      /**
       * Список сдавших отдаём по **самому заданию**, а не по уроку: право проверяет
       * `resolveStudentAccess` внутри `getForLesson`, и нам нужен сам объект задания.
       */
      const assignment = await homeworkRepository.findAssignment(assignmentId);
      if (assignment === null) throw new AppError('NOT_FOUND', 'Задание не найдено');

      const access = await dependencies.resolveStudentAccess({
        viewerUserId: viewer.userId,
        scope: staffScopeOf(viewer),
        assignmentId,
      });

      if (access === null) throw new AppError('NOT_FOUND', 'Задание не найдено');

      const items = await submissions.list({ assignment: access.assignment });

      return listSubmissionsResponseSchema.parse({ items, total: items.length });
    });

    /**
     * Отметки о домашнем задании для расписания.
     *
     * В расписании не нужен текст: нужно видеть, **есть ли задание** — ученику, что задано на
     * эту дату, преподавателю, что он в этот день уже ставил. Отдельный маршрут со списком
     * уроков: так расписание получает отметки **одним запросом**, а не по уроку за раз.
     */
    app.get('/homework/lesson-flags', async (request) => {
      const query = request.query as { lessonIds?: string | string[] };
      /** При одном значении Fastify отдаёт строку, а не массив: приводим сами. */
      const lessonIds = Array.isArray(query.lessonIds)
        ? query.lessonIds
        : query.lessonIds === undefined
          ? []
          : [query.lessonIds];

      if (lessonIds.length === 0) return lessonHomeworkFlagsResponseSchema.parse({ items: [] });

      const items = await service.listFlags({ viewer: viewerOf(request), lessonIds });

      return lessonHomeworkFlagsResponseSchema.parse({ items });
    });

    /**
     * Задание урока: экран журнала.
     *
     * Отдаём **две группы**: `assignedHere` — что задано на этом уроке (это правит учитель),
     * `dueHere` — что нужно сдать к этому уроку, включая заданное раньше. Учитель видит
     * плашку «домашняя работа от 8-го» и может задать новое, не затирая прошлое.
     *
     * `dueOptions` — ближайшие уроки того же предмета и группы: из них выбирается срок вместо
     * ввода даты.
     */
    app.get('/homework/lesson/:lessonId', async (request) => {
      const { lessonId } = request.params as { lessonId: string };
      const viewer = viewerOf(request);

      const lesson = await findLesson(lessonId);
      if (lesson === null) throw new AppError('NOT_FOUND', 'Урок не найден');

      const homework = await service.getForLesson({ viewer, lessonId });
      const dueOptions = await service.listDueOptions({ lesson });

      return lessonHomeworkResponseSchema.parse({
        assignedHere: homework.assignedHere.map(toSummary),
        dueHere: homework.dueHere.map(toSummary),
        dueOptions,
      });
    });

    /**
     * Задания на дату: ученик и представитель видят задания своих групп.
     *
     * Ищем не по дате, а по **урокам-срокам**: задание привязано к занятию, и «что сдать в
     * этот день» — это «какие уроки сегодня и что к ним задано».
     */
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

      const today = new Date().toISOString().slice(0, 10);
      const from = query.from ?? today;
      const to = query.to ?? from;

      const items: HomeworkAssignmentSummaryDto[] = [];
      for (const studyGroupId of targetGroups) {
        const lessons = await listLessonsForGroup(studyGroupId, from, to);
        if (lessons.length === 0) continue;

        const details = await service.listDue({
          viewer,
          dueLessonIds: lessons.map((lesson) => lesson.id),
        });

        for (const detail of details) {
          items.push(toSummary(detail));
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
        dueLessonId: body.dueLessonId ?? null,
        links: body.links.map((link) => ({ url: link.url, title: link.title ?? null })),
        fileIds: body.fileIds,
      });

      await audit.record(
        {
          action: 'create',
          entityKind: 'homework_assignment',
          entityId: created.id,
          after: { lessonId: body.lessonId, dueLessonId: body.dueLessonId ?? null },
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

      const change = await service.updateAssignment({
        viewer,
        assignmentId,
        ...(body.text === undefined ? {} : { text: body.text }),
        ...(body.dueLessonId === undefined ? {} : { dueLessonId: body.dueLessonId }),
        ...(body.links === undefined
          ? {}
          : {
              links: body.links.map((link) => ({
                url: link.url,
                title: link.title ?? null,
              })),
            }),
        ...(body.fileIds === undefined ? {} : { fileIds: body.fileIds }),
        ...(body.keepFileIds === undefined ? {} : { keepFileIds: body.keepFileIds }),
      });

      /**
       * В аудит пишем **до и после**: спор «я этого не менял» решается фактами. Полный текст
       * задания не сохраняем — в журнале, который хранится долго, достаточно факта правки и
       * длины; для разбора этого хватает.
       */
      await audit.record(
        {
          action: 'update',
          entityKind: 'homework_assignment',
          entityId: assignmentId,
          before: change.before,
          after: change.after,
        },
        actorFromRequest(request),
      );

      return { ok: true };
    });

    app.delete('/homework/:assignmentId', async (request) => {
      const { assignmentId } = request.params as { assignmentId: string };

      const removed = await service.removeAssignment({ viewer: viewerOf(request), assignmentId });

      /**
       * Удаление **мягкое**: задание скрывается, но история и сдачи остаются. В аудите
       * сохраняем снимок — по нему видно, что именно убрали.
       */
      await audit.record(
        {
          action: 'delete',
          entityKind: 'homework_assignment',
          entityId: assignmentId,
          before: removed.removed,
        },
        actorFromRequest(request),
      );

      return { ok: true };
    });
  };
}
