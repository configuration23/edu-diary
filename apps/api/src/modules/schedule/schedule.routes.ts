import {
  bellScheduleSchema,
  createScheduleEntryRequestSchema,
  createScheduleExceptionRequestSchema,
  createSubstitutionRequestSchema,
  generateLessonsRequestSchema,
  lessonSchema,
  listLessonsQuerySchema,
  listBellsResponseSchema,
  listGroupOptionsResponseSchema,
  listLessonsResponseSchema,
  listSubstitutionsQuerySchema,
  listScheduleExceptionsResponseSchema,
  listScheduleQuerySchema,
  listScheduleResponseSchema,
  listSubstituteCandidatesResponseSchema,
  listSubstitutionsResponseSchema,
  scheduleEntrySchema,
  scheduleExceptionSchema,
  substitutionSchema,
  updateLessonRequestSchema,
  updateScheduleEntryRequestSchema,
  upsertBellRequestSchema,
  type LessonDto,
  type ScheduleEntryDto,
  type ScheduleExceptionDto,
  type SubstitutionDto,
} from '@edu-diary/contracts';
import type { FastifyInstance } from 'fastify';

import { actorFromRequest } from '../../shared/actor';
import { AppError } from '../../shared/errors';
import { authHasPermission } from '../../shared/auth-context';
import { authOf, requirePermission } from '../../shared/guards';
import type {
  LessonRecord,
  ScheduleEntryRecord,
  ScheduleExceptionRecord,
  SubstitutionRecord,
} from './schedule.repository';
import type { CatalogLookupPort, ScheduleService, UserLookupPort } from './schedule.service';

function toEntryDto(entry: ScheduleEntryRecord): ScheduleEntryDto {
  return {
    id: entry.id,
    assignmentId: entry.assignmentId,
    studyGroupId: entry.studyGroupId,
    groupName: entry.groupName,
    subjectId: entry.subjectId,
    subjectName: entry.subjectName,
    teacherUserId: entry.teacherUserId,
    teacherName: '',
    roomId: entry.roomId,
    roomName: entry.roomName,
    dayOfWeek: entry.dayOfWeek,
    pairNumber: entry.pairNumber,
    timeStart: entry.timeStart,
    timeEnd: entry.timeEnd,
    validFrom: entry.validFrom,
    validTo: entry.validTo,
  };
}

function toLessonDto(
  lesson: LessonRecord,
  teacherNames: Map<string, string>,
  substitutionByLesson: Map<string, string> = new Map(),
): LessonDto {
  return {
    id: lesson.id,
    scheduleEntryId: lesson.scheduleEntryId,
    assignmentId: lesson.assignmentId,
    studyGroupId: lesson.studyGroupId,
    groupName: lesson.groupName,
    subjectId: lesson.subjectId,
    subjectName: lesson.subjectName,
    subjectShortName: lesson.subjectShortName,
    subjectColor: lesson.subjectColor,
    teacherUserId: lesson.teacherUserId,
    teacherName: teacherNames.get(lesson.teacherUserId) ?? '',
    plannedTeacherUserId: lesson.plannedTeacherUserId,
    plannedTeacherName:
      lesson.plannedTeacherUserId === null
        ? null
        : (teacherNames.get(lesson.plannedTeacherUserId) ?? null),
    roomId: lesson.roomId,
    roomName: lesson.roomName,
    lessonDate: lesson.lessonDate,
    pairNumber: lesson.pairNumber,
    timeStart: lesson.timeStart,
    timeEnd: lesson.timeEnd,
    topic: lesson.topic,
    lessonType: lesson.lessonType,
    status: lesson.status as LessonDto['status'],
    substitutionId: substitutionByLesson.get(lesson.id) ?? null,
    isManual: lesson.isManual,
    createdAt: lesson.createdAt.toISOString(),
  };
}

function toExceptionDto(exception: ScheduleExceptionRecord): ScheduleExceptionDto {
  return {
    id: exception.id,
    scheduleEntryId: exception.scheduleEntryId,
    studyGroupId: exception.studyGroupId,
    groupName: exception.groupName,
    exceptionDate: exception.exceptionDate,
    pairNumber: exception.pairNumber,
    action: exception.action as ScheduleExceptionDto['action'],
    payload: exception.payload,
    reason: exception.reason,
    createdAt: exception.createdAt.toISOString(),
  };
}

function toSubstitutionDto(
  substitution: SubstitutionRecord,
  userNames: Map<string, string>,
): SubstitutionDto {
  return {
    id: substitution.id,
    assignmentId: substitution.assignmentId,
    lessonId: substitution.lessonId,
    substituteUserId: substitution.substituteUserId,
    substituteName: userNames.get(substitution.substituteUserId) ?? '',
    replacedUserId: substitution.replacedUserId,
    replacedName: userNames.get(substitution.replacedUserId) ?? '',
    startsOn: substitution.startsOn,
    endsOn: substitution.endsOn,
    reason: substitution.reason,
    createdByName:
      substitution.createdBy === null ? null : (userNames.get(substitution.createdBy) ?? null),
    createdAt: substitution.createdAt.toISOString(),
  };
}

/**
 * Маршруты расписания и уроков.
 *
 * Права: `schedule:read` — преподаватель видит свои занятия (`assigned`), ученик и
 * родитель — расписание своих групп (`own`); `schedule:write` — администратор;
 * уроки — `lessons:read`/`lessons:write`; замены — `substitutions:write`.
 *
 * Область `own` не «фильтр на клиенте»: сервис получает список доступных групп и
 * сужает выборку до него, поэтому чужое расписание не отдаётся даже при прямом
 * запросе к API.
 */
export function registerScheduleRoutes(
  app: FastifyInstance,
  schedule: ScheduleService,
  catalog: CatalogLookupPort,
  users: UserLookupPort,
): void {
  /** Группы, доступные смотрящему: `undefined` — без ограничения. */
  const visibleGroupIds = async (
    request: Parameters<typeof authOf>[0],
    permission: string,
  ): Promise<readonly string[] | undefined> => {
    const auth = authOf(request);
    if (
      authHasPermission(auth, permission, 'all') ||
      authHasPermission(auth, permission, 'assigned')
    ) {
      return undefined;
    }

    // Область `own`: доступны только свои группы. Для ученика это группы, где он
    // учится, для родителя — группы его подопечных (ADR-005, ADR-031).
    return (await catalog.groupsOfViewer(auth.userId)).map((group) => group.id);
  };

  // --- Звонки: сетка времени по номеру пары ---

  /**
   * Группы, расписание которых доступно смотрящему.
   *
   * Нужно ролям без права `academics:read@all` (ученик, родитель): иначе список
   * групп пуст, и расписание не из чего выбрать.
   */
  app.get(
    '/schedule/my-groups',
    { preHandler: requirePermission('schedule:read', 'own') },
    async (request) => {
      const auth = authOf(request);
      const items = await schedule.listVisibleGroups({
        userId: auth.userId,
        seesAll:
          authHasPermission(auth, 'schedule:read', 'all') ||
          authHasPermission(auth, 'schedule:read', 'assigned'),
      });

      return listGroupOptionsResponseSchema.parse({ items });
    },
  );

  app.get('/bells', { preHandler: requirePermission('schedule:read', 'own') }, async () =>
    listBellsResponseSchema.parse({ items: await schedule.listBells() }),
  );

  app.put('/bells', { preHandler: requirePermission('schedule:write', 'all') }, async (request) => {
    const body = upsertBellRequestSchema.parse(request.body);
    const saved = await schedule.saveBell(body, { actor: actorFromRequest(request) });

    return bellScheduleSchema.parse(saved);
  });

  app.delete(
    '/bells/:pairNumber',
    { preHandler: requirePermission('schedule:write', 'all') },
    async (request, reply) => {
      const { pairNumber } = request.params as { pairNumber: string };
      await schedule.deleteBell(Number(pairNumber), { actor: actorFromRequest(request) });

      reply.status(204);
      return null;
    },
  );

  app.get(
    '/schedule',
    { preHandler: requirePermission('schedule:read', 'own') },
    async (request) => {
      const query = listScheduleQuerySchema.parse(request.query);
      const groups = await visibleGroupIds(request, 'schedule:read');

      const items = await schedule.listEntries({
        studyGroupId: query.studyGroupId,
        teacherUserId: query.teacherUserId,
        studyGroupIds: groups,
      });

      return listScheduleResponseSchema.parse({
        items: items.map(toEntryDto),
        total: items.length,
      });
    },
  );

  app.post(
    '/schedule',
    { preHandler: requirePermission('schedule:write', 'all') },
    async (request, reply) => {
      const body = createScheduleEntryRequestSchema.parse(request.body);

      const created = await schedule.createEntry(body, { actor: actorFromRequest(request) });

      reply.status(201);
      return scheduleEntrySchema.parse(toEntryDto(created));
    },
  );

  app.get(
    '/schedule/:id',
    { preHandler: requirePermission('schedule:read', 'own') },
    async (request) => {
      const { id } = request.params as { id: string };
      const entry = await schedule.getEntry(id);

      return scheduleEntrySchema.parse(toEntryDto(entry));
    },
  );

  app.patch(
    '/schedule/:id',
    { preHandler: requirePermission('schedule:write', 'all') },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = updateScheduleEntryRequestSchema.parse(request.body);
      const updated = await schedule.updateEntry(id, body, { actor: actorFromRequest(request) });

      return scheduleEntrySchema.parse(toEntryDto(updated));
    },
  );

  app.delete(
    '/schedule/:id',
    { preHandler: requirePermission('schedule:write', 'all') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await schedule.deleteEntry(id, { actor: actorFromRequest(request) });

      reply.status(204);
      return null;
    },
  );

  app.get(
    '/schedule/exceptions',
    { preHandler: requirePermission('schedule:read', 'own') },
    async (request) => {
      const query = listScheduleQuerySchema.parse(request.query);
      const items = await schedule.listExceptions({
        studyGroupId: query.studyGroupId,
      });

      return listScheduleExceptionsResponseSchema.parse({
        items: items.map(toExceptionDto),
        total: items.length,
      });
    },
  );

  app.post(
    '/schedule/exceptions',
    { preHandler: requirePermission('schedule:write', 'all') },
    async (request, reply) => {
      const body = createScheduleExceptionRequestSchema.parse(request.body);
      const created = await schedule.createException(body, { actor: actorFromRequest(request) });

      reply.status(201);
      return scheduleExceptionSchema.parse(toExceptionDto(created));
    },
  );

  app.delete(
    '/schedule/exceptions/:id',
    { preHandler: requirePermission('schedule:write', 'all') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await schedule.deleteException(id, { actor: actorFromRequest(request) });

      reply.status(204);
      return null;
    },
  );

  app.get('/lessons', { preHandler: requirePermission('lessons:read', 'own') }, async (request) => {
    const query = listLessonsQuerySchema.parse(request.query);
    const auth = authOf(request);
    const groups = await visibleGroupIds(request, 'lessons:read');

    // Область `assigned`: преподаватель видит свои уроки — включая те, где он
    // заменяющий (ADR-032), иначе замена была бы бессмысленной.
    const teacherUserId = authHasPermission(auth, 'lessons:read', 'all')
      ? query.teacherUserId
      : authHasPermission(auth, 'lessons:read', 'assigned')
        ? (query.teacherUserId ?? auth.userId)
        : undefined;

    const { items, total } = await schedule.listLessons({
      studyGroupId: query.studyGroupId,
      teacherUserId,
      studyGroupIds: groups,
      from: query.from,
      to: query.to,
      status: query.status,
      substitutedOnly: query.substitutedOnly,
      limit: query.limit,
      offset: query.offset,
    });

    const names = await teacherNames(items);
    const substitutions = await substitutionsByLesson(items);

    return listLessonsResponseSchema.parse({
      items: items.map((lesson) => toLessonDto(lesson, names, substitutions)),
      total,
    });
  });

  /**
   * Замены для переданных уроков: `lessonId → substitutionId`.
   *
   * Урок хранит только признак замены, а её запись (с причиной) лежит отдельно.
   * Список замен небольшой: активные замены ограничены периодом расписания.
   */
  const substitutionsByLesson = async (lessons: LessonRecord[]): Promise<Map<string, string>> => {
    const ids = new Set(lessons.map((lesson) => lesson.id));
    if (ids.size === 0) return new Map();

    const substitutions = await schedule.listSubstitutions({});
    const map = new Map<string, string>();

    for (const substitution of substitutions) {
      if (substitution.lessonId !== null && ids.has(substitution.lessonId)) {
        map.set(substitution.lessonId, substitution.id);
      }
    }

    return map;
  };

  app.get(
    '/lessons/:id',
    { preHandler: requirePermission('lessons:read', 'own') },
    async (request) => {
      const { id } = request.params as { id: string };
      const lesson = await schedule.getLesson(id);
      const names = await teacherNames([lesson]);
      const substitutions = await substitutionsByLesson([lesson]);

      return lessonSchema.parse(toLessonDto(lesson, names, substitutions));
    },
  );

  /**
   * Кандидаты на замену для урока: активные преподаватели со статусом на слот.
   *
   * Право то же, что у оформления замены: подбор нужен администратору, а не
   * каждому, кто видит урок.
   */
  app.get(
    '/lessons/:id/substitute-candidates',
    { preHandler: requirePermission('substitutions:write', 'all') },
    async (request) => {
      const { id } = request.params as { id: string };
      const items = await schedule.listSubstituteCandidates(id);

      return listSubstituteCandidatesResponseSchema.parse({ items });
    },
  );

  app.patch(
    '/lessons/:id',
    { preHandler: requirePermission('lessons:write', 'assigned') },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = updateLessonRequestSchema.parse(request.body);
      const auth = authOf(request);

      // Область ssigned: преподаватель правит только свой урок (в том числе
      // тот, где он заменяющий). Администратор правит любой.
      if (!authHasPermission(auth, 'lessons:write', 'all')) {
        const current = await schedule.getLesson(id);
        if (current.teacherUserId !== auth.userId) {
          throw new AppError('FORBIDDEN', 'Это не ваш урок');
        }
      }

      const updated = await schedule.updateLesson(id, body, { actor: actorFromRequest(request) });
      const names = await teacherNames([updated]);

      return lessonSchema.parse(toLessonDto(updated, names));
    },
  );

  app.delete(
    '/lessons/:id',
    { preHandler: requirePermission('lessons:write', 'assigned') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const auth = authOf(request);

      if (!authHasPermission(auth, 'lessons:write', 'all')) {
        const current = await schedule.getLesson(id);
        if (current.teacherUserId !== auth.userId) {
          throw new AppError('FORBIDDEN', 'Это не ваш урок');
        }
      }

      // Отмена — это исключение на дату, а не удаление строки: урок остаётся с
      // пометкой `cancelled`, поэтому повторная генерация за тот же период не
      // создаст занятие заново (ADR-006, ADR-009). Причина по умолчанию —
      // «отменено вручную», её можно заменить своим объяснением.
      const current = await schedule.getLesson(id);
      const entryId = current.scheduleEntryId;
      const actor = actorFromRequest(request);

      if (entryId === null) {
        await schedule.deleteLesson(id, { actor });
      } else {
        await schedule.createException(
          {
            scheduleEntryId: entryId,
            exceptionDate: current.lessonDate,
            action: 'cancel',
            payload: {},
            reason: 'Отменено вручную',
          },
          { actor },
        );
      }

      reply.status(204);
      return null;
    },
  );

  app.post(
    '/lessons/generate',
    { preHandler: requirePermission('schedule:write', 'all') },
    async (request) => {
      const body = generateLessonsRequestSchema.parse(request.body);
      const result = await schedule.generateLessons(body, { actor: actorFromRequest(request) });

      return result;
    },
  );

  /**
   * Что удалит пересоздание: показывается до нажатия, чтобы предупреждение
   * содержало реальные числа, а не общую фразу.
   */
  app.post(
    '/lessons/generation-preview',
    { preHandler: requirePermission('schedule:write', 'all') },
    async (request) => {
      const body = generateLessonsRequestSchema.parse(request.body);

      return schedule.previewLessonGeneration(body);
    },
  );

  app.get(
    '/substitutions',
    { preHandler: requirePermission('lessons:read', 'own') },
    async (request) => {
      const query = listSubstitutionsQuerySchema.parse(request.query);
      const items = await schedule.listSubstitutions({
        lessonId: query.lessonId,
        assignmentId: query.assignmentId,
        substituteUserId: query.substituteUserId,
      });

      const ids = new Set<string>();
      for (const item of items) {
        ids.add(item.substituteUserId);
        ids.add(item.replacedUserId);
        if (item.createdBy !== null) ids.add(item.createdBy);
      }
      const names = await users.findUsers([...ids]);

      return listSubstitutionsResponseSchema.parse({
        items: items.map((item) => toSubstitutionDto(item, names)),
        total: items.length,
      });
    },
  );

  app.post(
    '/substitutions',
    { preHandler: requirePermission('substitutions:write', 'all') },
    async (request, reply) => {
      const body = createSubstitutionRequestSchema.parse(request.body);
      const created = await schedule.createSubstitution(body, { actor: actorFromRequest(request) });

      reply.status(201);
      return substitutionSchema.parse(toSubstitutionDto(created, new Map()));
    },
  );

  app.delete(
    '/substitutions/:id',
    { preHandler: requirePermission('substitutions:write', 'all') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await schedule.deleteSubstitution(id, { actor: actorFromRequest(request) });

      reply.status(204);
      return null;
    },
  );

  /** Имена преподавателей одним проходом: в уроке их может быть двое. */
  async function teacherNames(lessons: readonly LessonRecord[]): Promise<Map<string, string>> {
    const ids = new Set<string>();
    for (const lesson of lessons) {
      ids.add(lesson.teacherUserId);
      if (lesson.plannedTeacherUserId !== null) ids.add(lesson.plannedTeacherUserId);
    }

    return users.findUsers([...ids]);
  }
}
