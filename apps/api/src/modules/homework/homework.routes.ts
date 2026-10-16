import type { FastifyInstance } from 'fastify';

import {
  createHomeworkRequestSchema,
  homeworkAssignmentSummarySchema,
  listHomeworkQuerySchema,
  listHomeworkResponseSchema,
  updateHomeworkRequestSchema,
  type HomeworkAssignmentSummaryDto,
} from '@edu-diary/contracts';

import { actorFromRequest } from '../../shared/actor';
import { authOf } from '../../shared/guards';
import type { AuditService } from '../audit';
import type { LessonRecord } from '../schedule';
import { createHomeworkRepository } from './homework.repository';
import {
  createHomeworkService,
  type HomeworkDetail,
  type HomeworkViewer,
} from './homework.service';
import type { Database } from '../../shared/db/client';

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

  const viewerOf = (request: Parameters<typeof authOf>[0]): HomeworkViewer => {
    const auth = authOf(request);
    return { userId: auth.userId, permissions: auth.permissions };
  };

  return async function homeworkModule(app: FastifyInstance): Promise<void> {
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
