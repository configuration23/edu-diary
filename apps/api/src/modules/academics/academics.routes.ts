import {
  createAcademicYearRequestSchema,
  createPeriodRequestSchema,
  createStudentRequestSchema,
  listAcademicYearsResponseSchema,
  listPeriodsResponseSchema,
  listStudentsQuerySchema,
  listStudentsResponseSchema,
  updateStudentRequestSchema,
  type StudentSummaryDto,
} from '@edu-diary/contracts';
import type { FastifyInstance } from 'fastify';

import { actorFromRequest } from '../../shared/actor';
import { authHasPermission } from '../../shared/auth-context';
import { authOf, requirePermission } from '../../shared/guards';
import type { StudentRecord } from './academics.repository';
import type { AcademicsService } from './academics.service';

function toStudentDto(student: StudentRecord): StudentSummaryDto {
  return {
    id: student.id,
    userId: student.userId,
    fullName: student.fullName,
    shortName: student.shortName,
    birthDate: student.birthDate,
    note: student.note,
  };
}

export function registerAcademicsRoutes(app: FastifyInstance, academics: AcademicsService): void {
  app.get(
    '/students',
    { preHandler: requirePermission('students:read', 'assigned') },
    async (request) => {
      const query = listStudentsQuerySchema.parse(request.query);
      const { items, total } = await academics.listStudents({
        search: query.search,
        limit: query.limit,
        offset: query.offset,
      });

      return listStudentsResponseSchema.parse({ items: items.map(toStudentDto), total });
    },
  );

  /** Выгрузка списка: попадает в аудит доступа (ADR-017). */
  app.get(
    '/students/export.csv',
    {
      preHandler: [
        requirePermission('students:read', 'assigned'),
        requirePermission('analytics:export', 'assigned'),
      ],
    },
    async (request, reply) => {
      const { csv, rows } = await academics.exportStudentsCsv(actorFromRequest(request));

      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="students.csv"')
        .header('x-exported-rows', String(rows));

      return csv;
    },
  );

  /**
   * Карточка ученика. Право `students:read` с областью `own` есть у ученика и
   * родителя — кому именно доступен конкретный ученик, решает сервис
   * (инвариант приватности, ADR-005).
   */
  app.get(
    '/students/:id',
    { preHandler: requirePermission('students:read', 'own') },
    async (request) => {
      const { id } = request.params as { id: string };
      const auth = authOf(request);
      const actor = actorFromRequest(request);

      const student = await academics.getStudentForViewer(id, {
        userId: auth.userId,
        canReadAnyStudent: authHasPermission(auth, 'students:read', 'assigned'),
        actor,
      });

      return toStudentDto(student);
    },
  );

  app.post(
    '/students',
    { preHandler: requirePermission('students:write', 'all') },
    async (request, reply) => {
      const body = createStudentRequestSchema.parse(request.body);
      const created = await academics.createStudent(body, { actor: actorFromRequest(request) });

      reply.status(201);
      return toStudentDto(created);
    },
  );

  app.patch(
    '/students/:id',
    { preHandler: requirePermission('students:write', 'all') },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = updateStudentRequestSchema.parse(request.body);
      const updated = await academics.updateStudent(id, body, {
        actor: actorFromRequest(request),
      });

      return toStudentDto(updated);
    },
  );

  app.get(
    '/academic-years',
    { preHandler: requirePermission('academics:read', 'all') },
    async () => {
      const items = await academics.listAcademicYears();
      return listAcademicYearsResponseSchema.parse({ items });
    },
  );

  app.post(
    '/academic-years',
    { preHandler: requirePermission('academics:write', 'all') },
    async (request, reply) => {
      const body = createAcademicYearRequestSchema.parse(request.body);
      const created = await academics.createAcademicYear(body, {
        actor: actorFromRequest(request),
      });

      reply.status(201);
      return created;
    },
  );

  app.get(
    '/periods',
    { preHandler: requirePermission('academics:read', 'all') },
    async (request) => {
      const query = request.query as { academicYearId?: string };
      const items = await academics.listPeriods(query.academicYearId);
      return listPeriodsResponseSchema.parse({ items });
    },
  );

  app.post(
    '/periods',
    { preHandler: requirePermission('academics:write', 'all') },
    async (request, reply) => {
      const body = createPeriodRequestSchema.parse(request.body);
      const created = await academics.createPeriod(body, { actor: actorFromRequest(request) });

      reply.status(201);
      return created;
    },
  );
}
