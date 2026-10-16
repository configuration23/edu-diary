import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';

import type { AccessScope } from '@edu-diary/domain';
import {
  createHomeworkRequestSchema,
  homeworkAssignmentSummarySchema,
  listHomeworkQuerySchema,
  listHomeworkResponseSchema,
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
import { createFileService } from './homework.files.service';
import { createHomeworkRepository } from './homework.repository';
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
  mayReadFile: (input: {
    viewerUserId: string;
    /** Область права на проверку: ll — администратор, иначе только свой урок. */
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

  const files = createFileService({
    repository: fileRepository,
    adapter: dependencies.storageAdapter,
  });

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

    app.post('/homework/files', async (request, reply) => {
      const viewer = viewerOf(request);
      if (!has(viewer, 'homework:write')) {
        throw new AppError('FORBIDDEN', 'Недостаточно прав: homework:write');
      }

      const file = await request.file();
      if (file === undefined) throw new AppError('VALIDATION_FAILED', 'Файл не передан');

      const body = await file.toBuffer();
      const limits = await dependencies.storageLimits();

      const uploaded = await files.upload({
        fileName: file.filename,
        body,
        uploadedBy: viewer.userId,
        maxFileMb: limits.maxFileMb,
        allowedExtensions: limits.allowedExtensions,
      });

      // 201: файл создан. Ответ содержит идентификатор, который потом привяжут к заданию.
      reply.status(201);
      return uploadFileResponseSchema.parse(uploaded);
    });

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
        scope:
          viewer.permissions.get('homework:review') ?? viewer.permissions.get('homework:write'),
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
