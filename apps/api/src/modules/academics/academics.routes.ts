import {
  academicYearWithPeriodsSchema,
  createAcademicYearRequestSchema,
  createGradeCategoryRequestSchema,
  createGroupRequestSchema,
  createPeriodRequestSchema,
  createRoomRequestSchema,
  createStudentRequestSchema,
  createSubjectRequestSchema,
  enrollStudentRequestSchema,
  enrollStudentResponseSchema,
  enrollmentSchema,
  gradeCategorySchema,
  listAcademicYearsResponseSchema,
  listEnrollmentsResponseSchema,
  listGradeCategoriesResponseSchema,
  listGroupsQuerySchema,
  listGroupsResponseSchema,
  listPeriodsResponseSchema,
  listRoomsResponseSchema,
  listStudentsQuerySchema,
  listStudentsResponseSchema,
  listSubjectsResponseSchema,
  periodSchema,
  roomSchema,
  studyGroupSchema,
  subjectSchema,
  transferStudentRequestSchema,
  updateAcademicYearRequestSchema,
  updateGradeCategoryRequestSchema,
  updateGroupRequestSchema,
  updatePeriodRequestSchema,
  updateRoomRequestSchema,
  updateStudentRequestSchema,
  updateSubjectRequestSchema,
  withdrawStudentRequestSchema,
  type AcademicYearDto,
  type EnrollmentDto,
  type GradeCategoryDto,
  type PeriodDto,
  type RoomDto,
  type StudentSummaryDto,
  type StudyGroupDto,
  type SubjectDto,
} from '@edu-diary/contracts';
import type { FastifyInstance } from 'fastify';

import { actorFromRequest } from '../../shared/actor';
import { authHasPermission } from '../../shared/auth-context';
import { authOf, requirePermission } from '../../shared/guards';
import type {
  AcademicYearRecord,
  EnrollmentRecord,
  GradeCategoryRecord,
  PeriodRecord,
  RoomRecord,
  StudentRecord,
  StudyGroupRecord,
  SubjectRecord,
} from './academics.repository';
import type { AcademicsService, MutationOptions } from './academics.service';

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

function toYearDto(year: AcademicYearRecord): AcademicYearDto {
  return {
    id: year.id,
    title: year.title,
    startsOn: year.startsOn,
    endsOn: year.endsOn,
    isActive: year.isActive,
  };
}

function toPeriodDto(period: PeriodRecord): PeriodDto {
  return {
    id: period.id,
    academicYearId: period.academicYearId,
    title: period.title,
    kind: period.kind as PeriodDto['kind'],
    startsOn: period.startsOn,
    endsOn: period.endsOn,
    sort: period.sort,
  };
}

function toGroupDto(group: StudyGroupRecord): StudyGroupDto {
  return {
    id: group.id,
    academicYearId: group.academicYearId,
    name: group.name,
    course: group.course,
    specialty: group.specialty,
    curatorUserId: group.curatorUserId,
    startsOn: group.startsOn,
    endsOn: group.endsOn,
    studentsCount: group.studentsCount,
  };
}

function toEnrollmentDto(enrollment: EnrollmentRecord): EnrollmentDto {
  return {
    id: enrollment.id,
    studentId: enrollment.studentId,
    studyGroupId: enrollment.studyGroupId,
    studentName: enrollment.studentName,
    joinedOn: enrollment.joinedOn,
    leftOn: enrollment.leftOn,
    note: enrollment.note,
  };
}

function toSubjectDto(subject: SubjectRecord): SubjectDto {
  return {
    id: subject.id,
    name: subject.name,
    shortName: subject.shortName,
    kind: subject.kind as SubjectDto['kind'],
    color: subject.color,
  };
}

function toRoomDto(room: RoomRecord): RoomDto {
  return { id: room.id, name: room.name, capacity: room.capacity, note: room.note };
}

function toCategoryDto(category: GradeCategoryRecord): GradeCategoryDto {
  return {
    id: category.id,
    code: category.code,
    title: category.title,
    weight: category.weight,
    color: category.color,
    isDefault: category.isDefault,
  };
}

/** Маршруты учебного процесса: ученики, годы и периоды, группы, справочники. */
export function registerAcademicsRoutes(app: FastifyInstance, academics: AcademicsService): void {
  /** Актор запроса для аудита: одна строка вместо повторения в каждом маршруте. */
  const mutation = (request: Parameters<typeof actorFromRequest>[0]): MutationOptions => ({
    actor: actorFromRequest(request),
  });

  // --- Ученики ---

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
      const created = await academics.createStudent(body, mutation(request));

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
      const updated = await academics.updateStudent(id, body, mutation(request));

      return toStudentDto(updated);
    },
  );

  /** Перевод ученика: закрывает текущее зачисление и открывает новое. */
  app.post(
    '/students/:id/transfer',
    { preHandler: requirePermission('students:write', 'all') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = transferStudentRequestSchema.parse(request.body);
      const created = await academics.transferStudent(id, body, mutation(request));

      reply.status(201);
      return enrollStudentResponseSchema.parse({ enrollment: toEnrollmentDto(created) });
    },
  );

  // --- Учебные годы и периоды ---

  app.get(
    '/academic-years',
    { preHandler: requirePermission('academics:read', 'all') },
    async () => {
      const items = await academics.listAcademicYears();
      return listAcademicYearsResponseSchema.parse({ items: items.map(toYearDto) });
    },
  );

  app.post(
    '/academic-years',
    { preHandler: requirePermission('academics:write', 'all') },
    async (request, reply) => {
      const body = createAcademicYearRequestSchema.parse(request.body);
      const created = await academics.createAcademicYear(body, mutation(request));

      reply.status(201);
      return toYearDto(created);
    },
  );

  /** Год вместе с периодами: экран «Учебный год» открывается одним запросом. */
  app.get(
    '/academic-years/:id',
    { preHandler: requirePermission('academics:read', 'all') },
    async (request) => {
      const { id } = request.params as { id: string };
      const year = await academics.getAcademicYear(id);
      const periods = await academics.listPeriods(id);

      return academicYearWithPeriodsSchema.parse({
        ...toYearDto(year),
        periods: periods.map(toPeriodDto),
      });
    },
  );

  app.patch(
    '/academic-years/:id',
    { preHandler: requirePermission('academics:write', 'all') },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = updateAcademicYearRequestSchema.parse(request.body);
      const updated = await academics.updateAcademicYear(id, body, mutation(request));

      return toYearDto(updated);
    },
  );

  app.post(
    '/academic-years/:id/activate',
    { preHandler: requirePermission('academics:write', 'all') },
    async (request) => {
      const { id } = request.params as { id: string };
      const updated = await academics.activateAcademicYear(id, mutation(request));

      return toYearDto(updated);
    },
  );

  /** Удаление года с группами или активного года запрещено: `409` с деталями. */
  app.delete(
    '/academic-years/:id',
    { preHandler: requirePermission('academics:write', 'all') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await academics.deleteAcademicYear(id, mutation(request));

      reply.status(204);
      return null;
    },
  );

  app.get(
    '/periods',
    { preHandler: requirePermission('academics:read', 'all') },
    async (request) => {
      const query = request.query as { academicYearId?: string };
      const items = await academics.listPeriods(query.academicYearId);
      return listPeriodsResponseSchema.parse({ items: items.map(toPeriodDto) });
    },
  );

  app.post(
    '/periods',
    { preHandler: requirePermission('academics:write', 'all') },
    async (request, reply) => {
      const body = createPeriodRequestSchema.parse(request.body);
      const created = await academics.createPeriod(body, mutation(request));

      reply.status(201);
      return periodSchema.parse(toPeriodDto(created));
    },
  );

  app.patch(
    '/periods/:id',
    { preHandler: requirePermission('academics:write', 'all') },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = updatePeriodRequestSchema.parse(request.body);
      const updated = await academics.updatePeriod(id, body, mutation(request));

      return periodSchema.parse(toPeriodDto(updated));
    },
  );

  // --- Группы и зачисления ---

  app.get(
    '/groups',
    { preHandler: requirePermission('academics:read', 'all') },
    async (request) => {
      const query = listGroupsQuerySchema.parse(request.query);
      const items = await academics.listGroups(query);

      return listGroupsResponseSchema.parse({ items: items.map(toGroupDto) });
    },
  );

  app.post(
    '/groups',
    { preHandler: requirePermission('academics:write', 'all') },
    async (request, reply) => {
      const body = createGroupRequestSchema.parse(request.body);
      const created = await academics.createGroup(body, mutation(request));

      reply.status(201);
      return studyGroupSchema.parse(toGroupDto(created));
    },
  );

  app.get(
    '/groups/:id',
    { preHandler: requirePermission('academics:read', 'all') },
    async (request) => {
      const { id } = request.params as { id: string };
      const group = await academics.getGroup(id);

      return studyGroupSchema.parse(toGroupDto(group));
    },
  );

  app.patch(
    '/groups/:id',
    { preHandler: requirePermission('academics:write', 'all') },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = updateGroupRequestSchema.parse(request.body);
      const updated = await academics.updateGroup(id, body, mutation(request));

      return studyGroupSchema.parse(toGroupDto(updated));
    },
  );

  app.delete(
    '/groups/:id',
    { preHandler: requirePermission('academics:write', 'all') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await academics.deleteGroup(id, mutation(request));

      reply.status(204);
      return null;
    },
  );

  /** Состав группы: право `students:read@assigned` есть у преподавателя. */
  app.get(
    '/groups/:id/students',
    { preHandler: requirePermission('students:read', 'assigned') },
    async (request) => {
      const { id } = request.params as { id: string };
      const items = await academics.listEnrollments(id);

      return listEnrollmentsResponseSchema.parse({ items: items.map(toEnrollmentDto) });
    },
  );

  app.post(
    '/groups/:id/enrollments',
    { preHandler: requirePermission('students:write', 'all') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = enrollStudentRequestSchema.parse(request.body);
      const created = await academics.enrollStudent(id, body, mutation(request));

      reply.status(201);
      return enrollStudentResponseSchema.parse({ enrollment: toEnrollmentDto(created) });
    },
  );

  /** Отчисление: зачисление закрывается датой, запись остаётся в истории. */
  app.patch(
    '/enrollments/:id',
    { preHandler: requirePermission('students:write', 'all') },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = withdrawStudentRequestSchema.parse(request.body);
      const updated = await academics.withdrawStudent(id, body.leftOn, mutation(request));

      return enrollmentSchema.parse(toEnrollmentDto(updated));
    },
  );

  // --- Справочники: предметы, аудитории, категории оценок ---

  app.get('/subjects', { preHandler: requirePermission('academics:read', 'all') }, async () => {
    const items = await academics.listSubjects();
    return listSubjectsResponseSchema.parse({ items: items.map(toSubjectDto) });
  });

  app.post(
    '/subjects',
    { preHandler: requirePermission('academics:write', 'all') },
    async (request, reply) => {
      const body = createSubjectRequestSchema.parse(request.body);
      const created = await academics.createSubject(body, mutation(request));

      reply.status(201);
      return subjectSchema.parse(toSubjectDto(created));
    },
  );

  app.patch(
    '/subjects/:id',
    { preHandler: requirePermission('academics:write', 'all') },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = updateSubjectRequestSchema.parse(request.body);
      const updated = await academics.updateSubject(id, body, mutation(request));

      return subjectSchema.parse(toSubjectDto(updated));
    },
  );

  /** Удаление предмета с историей запрещено: `409` с `details.usedBy`. */
  app.delete(
    '/subjects/:id',
    { preHandler: requirePermission('academics:write', 'all') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await academics.deleteSubject(id, mutation(request));

      reply.status(204);
      return null;
    },
  );

  app.get('/rooms', { preHandler: requirePermission('academics:read', 'all') }, async () => {
    const items = await academics.listRooms();
    return listRoomsResponseSchema.parse({ items: items.map(toRoomDto) });
  });

  app.post(
    '/rooms',
    { preHandler: requirePermission('academics:write', 'all') },
    async (request, reply) => {
      const body = createRoomRequestSchema.parse(request.body);
      const created = await academics.createRoom(body, mutation(request));

      reply.status(201);
      return roomSchema.parse(toRoomDto(created));
    },
  );

  app.patch(
    '/rooms/:id',
    { preHandler: requirePermission('academics:write', 'all') },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = updateRoomRequestSchema.parse(request.body);
      const updated = await academics.updateRoom(id, body, mutation(request));

      return roomSchema.parse(toRoomDto(updated));
    },
  );

  app.delete(
    '/rooms/:id',
    { preHandler: requirePermission('academics:write', 'all') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await academics.deleteRoom(id, mutation(request));

      reply.status(204);
      return null;
    },
  );

  app.get(
    '/grade-categories',
    { preHandler: requirePermission('academics:read', 'all') },
    async () => {
      const items = await academics.listGradeCategories();
      return listGradeCategoriesResponseSchema.parse({ items: items.map(toCategoryDto) });
    },
  );

  app.post(
    '/grade-categories',
    { preHandler: requirePermission('academics:write', 'all') },
    async (request, reply) => {
      const body = createGradeCategoryRequestSchema.parse(request.body);
      const created = await academics.createGradeCategory(body, mutation(request));

      reply.status(201);
      return gradeCategorySchema.parse(toCategoryDto(created));
    },
  );

  app.patch(
    '/grade-categories/:id',
    { preHandler: requirePermission('academics:write', 'all') },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = updateGradeCategoryRequestSchema.parse(request.body);
      const updated = await academics.updateGradeCategory(id, body, mutation(request));

      return gradeCategorySchema.parse(toCategoryDto(updated));
    },
  );

  app.delete(
    '/grade-categories/:id',
    { preHandler: requirePermission('academics:write', 'all') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await academics.deleteGradeCategory(id, mutation(request));

      reply.status(204);
      return null;
    },
  );
}
