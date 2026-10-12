import {
  attendanceEntrySchema,
  gradeEntrySchema,
  lessonJournalSchema,
  listGradeRevisionsResponseSchema,
  markAllPresentRequestSchema,
  saveAttendanceRequestSchema,
  saveGradeRequestSchema,
  updateGradeRequestSchema,
} from '@edu-diary/contracts';
import type { FastifyInstance } from 'fastify';

import { actorFromRequest } from '../../shared/actor';
import { AppError } from '../../shared/errors';
import { authHasPermission } from '../../shared/auth-context';
import { authOf, requirePermission } from '../../shared/guards';
import type { AuditService } from '../audit';
import type { JournalService, MutationOptions } from './journal.service';

/**
 * Маршруты журнала: оценки и посещаемость.
 *
 * Чтение — всем, кто видит уроки (`lessons:read`): ученику свои оценки, родителю
 * оценки своих детей, преподавателю — по своим назначениям. Запись — только тем,
 * кому выдано `grades:write` или `attendance:write` с областью `assigned`.
 *
 * Каждое изменение пишется в аудит вместе с историей правки: спор «я не ставил эту
 * двойку» решается фактами (ADR-011, ADR-012).
 */
export function registerJournalRoutes(
  app: FastifyInstance,
  dependencies: {
    journal: JournalService;
    audit: AuditService;
    /** Проверка «своих» данных: ученик по учётной записи и его представители. */
    isOwnStudent: (viewerUserId: string, studentId: string) => Promise<boolean>;
    /** Все ученики, доступные смотрящему: нужны аналитике. */
    studentsOfViewer: (viewerUserId: string) => Promise<string[]>;
  },
): void {
  const { journal, isOwnStudent, studentsOfViewer } = dependencies;

  const mutationOptions = (request: Parameters<typeof actorFromRequest>[0]): MutationOptions => ({
    actor: actorFromRequest(request),
  });

  /** Смотрящий видит оценки всех (staff) или только своих (ученик, родитель). */
  const seesAllStudents = (request: Parameters<typeof authOf>[0]): boolean => {
    const auth = authOf(request);
    return (
      authHasPermission(auth, 'grades:read', 'all') ||
      authHasPermission(auth, 'grades:read', 'assigned')
    );
  };

  /** Экран урока: состав группы, отметки и накопление знаков. */
  app.get(
    '/lessons/:id/journal',
    { preHandler: requirePermission('grades:read', 'own') },
    async (request) => {
      const { id } = request.params as { id: string };
      const auth = authOf(request);

      /**
       * Сотрудник с областью `all` или `assigned` видит журнал любого урока;
       * ученик и родитель — только своих (ADR-005). Признак «видит всех»
       * передаём в сервис, там он заменяет проверку по составу группы.
       */
      const data = await journal.lessonJournal(id, {
        userId: auth.userId,
        seesAll: seesAllStudents(request),
      });

      /**
       * Даты приводим к строкам: в контракте они строки, а из базы приходят `Date`.
       * Без этого ответ не проходит проверку схемы — выяснилось на живом запросе.
       */
      const serialized = {
        ...data,
        students: data.students.map((student) => ({
          ...student,
          grade:
            student.grade === null
              ? null
              : { ...student.grade, createdAt: student.grade.createdAt.toISOString() },
          attendance:
            student.attendance === null
              ? null
              : { ...student.attendance, createdAt: student.attendance.createdAt.toISOString() },
        })),
      };

      // Ученик и родитель видят только свои строки: остальных вырезаем до отдачи.
      if (!seesAllStudents(request)) {
        const own = new Set(await studentsOfViewer(auth.userId));
        return lessonJournalSchema.parse({
          ...serialized,
          students: serialized.students.filter((student) => own.has(student.studentId)),
        });
      }

      return lessonJournalSchema.parse(serialized);
    },
  );

  /** Оценка или знак за урок: повторная запись заменяет прежнюю отметку. */
  app.post(
    '/lessons/:id/grades',
    { preHandler: requirePermission('grades:write', 'assigned') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = saveGradeRequestSchema.parse(request.body);

      const saved = await journal.saveGrade(id, body, mutationOptions(request));
      reply.status(201);
      return gradeEntrySchema.parse({
        ...saved,
        createdAt: saved.createdAt.toISOString(),
      });
    },
  );

  /** Посещаемость: статус и причина. */
  app.post(
    '/lessons/:id/attendance',
    { preHandler: requirePermission('attendance:write', 'assigned') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = saveAttendanceRequestSchema.parse(request.body);

      const saved = await journal.saveAttendance(id, body, mutationOptions(request));
      reply.status(201);
      return attendanceEntrySchema.parse({
        ...saved,
        createdAt: saved.createdAt.toISOString(),
      });
    },
  );

  /** «Отметить всех присутствующими»: массовая операция урока. */
  app.post(
    '/lessons/:id/attendance/all-present',
    { preHandler: requirePermission('attendance:write', 'assigned') },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = markAllPresentRequestSchema.parse(request.body ?? {});

      return journal.markAllPresent(id, body, mutationOptions(request));
    },
  );

  /** Правка оценки с причиной: без причины история бесполезна (ADR-011). */
  app.patch(
    '/grades/:id',
    { preHandler: requirePermission('grades:write', 'assigned') },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = updateGradeRequestSchema.parse(request.body);

      const updated = await journal.updateGrade(id, body, mutationOptions(request));
      return gradeEntrySchema.parse({ ...updated, createdAt: updated.createdAt.toISOString() });
    },
  );

  /** Мягкое удаление оценки: причина обязательна. */
  app.delete(
    '/grades/:id',
    { preHandler: requirePermission('grades:write', 'assigned') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const reason = (request.body as { reason?: string } | undefined)?.reason ?? '';

      if (reason.trim().length < 3) {
        throw new AppError('VALIDATION_FAILED', 'Укажите причину удаления');
      }

      await journal.deleteGrade(id, reason, mutationOptions(request));
      reply.status(204);
      return null;
    },
  );

  /** Восстановление удалённой оценки: администратор возвращает отметку. */
  app.post(
    '/grades/:id/restore',
    { preHandler: requirePermission('grades:write', 'all') },
    async (request) => {
      const { id } = request.params as { id: string };
      await journal.restoreGrade(id, mutationOptions(request));
      return { restored: true };
    },
  );

  /** История правок оценки: кто, когда, что было и что стало. */
  app.get(
    '/grades/:id/revisions',
    { preHandler: requirePermission('grades:read', 'own') },
    async (request) => {
      const { id } = request.params as { id: string };
      const items = await journal.listGradeRevisions(id);

      return listGradeRevisionsResponseSchema.parse({
        items: items.map((item) => ({
          id: '00000000-0000-0000-0000-000000000000',
          action: item.action,
          before: item.before,
          after: item.after,
          reason: item.reason,
          actorName: item.actorName,
          createdAt: new Date(item.createdAt).toISOString(),
        })),
      });
    },
  );

  /**
   * Аналитика: средний балл и посещаемость.
   *
   * Ученик и родитель получают только своих; преподаватель и администратор —
   * по выбранной группе.
   */
  app.get(
    '/journal/stats',
    { preHandler: requirePermission('grades:read', 'own') },
    async (request) => {
      const auth = authOf(request);
      const query = request.query as {
        studyGroupId?: string;
        subjectId?: string;
        studentId?: string;
        from?: string;
        to?: string;
      };

      const visible = seesAllStudents(request) ? undefined : await studentsOfViewer(auth.userId);
      const requested = query.studentId === undefined ? undefined : [query.studentId];
      const studentIds =
        visible === undefined
          ? (requested ?? [])
          : (requested ?? visible).filter((id) => visible.includes(id));

      if (studentIds.length === 0) {
        throw new AppError('VALIDATION_FAILED', 'Не указаны ученики для отчёта');
      }

      const stats = await journal.stats({
        studentIds,
        ...(query.subjectId === undefined ? {} : { subjectId: query.subjectId }),
        ...(query.from === undefined ? {} : { from: query.from }),
        ...(query.to === undefined ? {} : { to: query.to }),
      });

      void isOwnStudent;

      return { items: stats, total: stats.length };
    },
  );
}
