import {
  assignmentSchema,
  closeAssignmentRequestSchema,
  closeAssignmentsForTeacherRequestSchema,
  createAssignmentRequestSchema,
  listAssignmentsQuerySchema,
  listAssignmentsResponseSchema,
  updateAssignmentRequestSchema,
  type AssignmentDto,
} from '@edu-diary/contracts';
import type { FastifyInstance } from 'fastify';

import { actorFromRequest } from '../../shared/actor';
import { authHasPermission } from '../../shared/auth-context';
import { authOf, requirePermission } from '../../shared/guards';
import type { AssignmentRow } from './staffing.repository';
import type { StaffingService } from './staffing.service';

function toAssignmentDto(assignment: AssignmentRow): AssignmentDto {
  return {
    id: assignment.id,
    teacherUserId: assignment.teacherUserId,
    teacherName: assignment.teacherName,
    subjectId: assignment.subjectId,
    subjectName: assignment.subjectName,
    studyGroupId: assignment.studyGroupId,
    groupName: assignment.groupName,
    startsOn: assignment.startsOn,
    endsOn: assignment.endsOn,
    hoursPlanned: assignment.hoursPlanned,
  };
}

/**
 * Маршруты назначений.
 *
 * Права: чтение — `assignments:read`. У преподавателя область `assigned`, и это
 * означает «только свои назначения»: право выдано ему ровно на `assigned`, чтобы
 * флаг «вижу всё» не появлялся. Изменение — `assignments:write` области `all`,
 * то есть администратор.
 */
export function registerStaffingRoutes(app: FastifyInstance, staffing: StaffingService): void {
  app.get(
    '/assignments',
    { preHandler: requirePermission('assignments:read', 'assigned') },
    async (request) => {
      const query = listAssignmentsQuerySchema.parse(request.query);
      const auth = authOf(request);

      const { items, total } = await staffing.listForViewer(
        {
          userId: auth.userId,
          canReadAll: authHasPermission(auth, 'assignments:read', 'all'),
        },
        {
          teacherUserId: query.teacherUserId,
          studyGroupId: query.studyGroupId,
          subjectId: query.subjectId,
          limit: query.limit,
          offset: query.offset,
        },
      );

      return listAssignmentsResponseSchema.parse({ items: items.map(toAssignmentDto), total });
    },
  );

  /** Свои назначения: тот же ответ, но фильтр по преподавателю не обойти. */
  app.get(
    '/assignments/mine',
    { preHandler: requirePermission('assignments:read', 'assigned') },
    async (request) => {
      const query = listAssignmentsQuerySchema.parse(request.query);
      const auth = authOf(request);

      const { items, total } = await staffing.listForViewer(
        { userId: auth.userId, canReadAll: false },
        {
          studyGroupId: query.studyGroupId,
          subjectId: query.subjectId,
          limit: query.limit,
          offset: query.offset,
        },
      );

      return listAssignmentsResponseSchema.parse({ items: items.map(toAssignmentDto), total });
    },
  );

  app.get(
    '/assignments/:id',
    { preHandler: requirePermission('assignments:read', 'assigned') },
    async (request) => {
      const { id } = request.params as { id: string };
      const assignment = await staffing.get(id);

      return assignmentSchema.parse(toAssignmentDto(assignment));
    },
  );

  app.post(
    '/assignments',
    { preHandler: requirePermission('assignments:write', 'all') },
    async (request, reply) => {
      const body = createAssignmentRequestSchema.parse(request.body);
      const created = await staffing.create(body, { actor: actorFromRequest(request) });

      reply.status(201);
      return assignmentSchema.parse(toAssignmentDto(created));
    },
  );

  app.patch(
    '/assignments/:id',
    { preHandler: requirePermission('assignments:write', 'all') },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = updateAssignmentRequestSchema.parse(request.body);
      const updated = await staffing.update(id, body, { actor: actorFromRequest(request) });

      return assignmentSchema.parse(toAssignmentDto(updated));
    },
  );

  /** Закрытие периода: дата окончания вместо удаления. */
  app.post(
    '/assignments/:id/close',
    { preHandler: requirePermission('assignments:write', 'all') },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = closeAssignmentRequestSchema.parse(request.body);
      const updated = await staffing.close(id, body.endsOn, {
        actor: actorFromRequest(request),
      });

      return assignmentSchema.parse(toAssignmentDto(updated));
    },
  );

  /** Массовое закрытие: например, преподаватель уходит из колледжа с даты. */
  app.post(
    '/assignments/close-for-teacher',
    { preHandler: requirePermission('assignments:write', 'all') },
    async (request) => {
      const body = closeAssignmentsForTeacherRequestSchema.parse(request.body);
      const closed = await staffing.closeAllForTeacher(body.teacherUserId, body.endsOn, {
        actor: actorFromRequest(request),
      });

      return { closed };
    },
  );

  /** Удаление разрешено только для закрытого назначения без уроков. */
  app.delete(
    '/assignments/:id',
    { preHandler: requirePermission('assignments:write', 'all') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await staffing.remove(id, { actor: actorFromRequest(request) });

      reply.status(204);
      return null;
    },
  );
}
