import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Executor } from '../../shared/db/client';
import { studyGroup, subject } from '../academics';
import { teachingAssignment } from '../staffing';
import { lesson as lessonTable } from '../schedule';
import {
  homeworkAssignment,
  homeworkAssignmentFile,
  homeworkLink,
  homeworkSubmission,
} from './homework.schema';

/**
 * Доступ к данным домашних заданий.
 *
 * SQL живёт только здесь (`ARCHITECTURE.md` §3). Задание всегда читается вместе с уроком:
 * группа, предмет и преподаватель нужны и для прав, и для показа, и брать их отдельными
 * запросами значило бы плодить запросы на каждый экран.
 */

export interface AssignmentWithContext {
  id: string;
  lessonId: string;
  text: string;
  dueOn: string | null;
  visibleUntil: string | null;
  createdAt: Date;
  lessonDate: string;
  lessonTeacherUserId: string | null;
  studyGroupId: string;
  groupName: string;
  subjectId: string;
  subjectName: string;
  subjectShortName: string | null;
}

export interface AssignmentFileRecord {
  id: string;
  assignmentId: string;
  storageKey: string;
  originalName: string;
  sizeBytes: number;
  mimeType: string;
  deletedAt: Date | null;
  createdAt: Date;
}

export interface AssignmentLinkRecord {
  id: string;
  assignmentId: string;
  url: string;
  title: string | null;
}

export interface HomeworkRepository {
  createAssignment(input: {
    lessonId: string;
    text: string;
    dueOn: string | null;
    visibleUntil: string | null;
    createdBy: string;
  }): Promise<{ id: string }>;
  updateAssignment(
    id: string,
    input: { text?: string; dueOn?: string | null; visibleUntil?: string | null },
  ): Promise<void>;
  softDeleteAssignment(id: string, actorUserId: string): Promise<void>;
  findAssignment(id: string): Promise<AssignmentWithContext | null>;
  /** Задания урока: ключ — урок. */
  listByLessonIds(lessonIds: readonly string[]): Promise<AssignmentWithContext[]>;
  /**
   * Задания, видимые в уроках на дату.
   *
   * Сюда попадают и задания этих уроков, и «продолжительные» задания того же предмета и
   * группы, у которых `visible_until` не меньше даты урока. Логику видимости задаёт домен,
   * а запрос отбирает кандидатов — так правило остаётся в одном месте.
   */
  listCandidates(input: {
    studyGroupId: string;
    fromDate: string;
    toDate: string;
  }): Promise<AssignmentWithContext[]>;
  addFiles(assignmentId: string, fileIds: readonly string[]): Promise<void>;
  listFiles(assignmentIds: readonly string[]): Promise<AssignmentFileRecord[]>;
  replaceLinks(
    assignmentId: string,
    links: readonly { url: string; title: string | null }[],
  ): Promise<void>;
  listLinks(assignmentIds: readonly string[]): Promise<AssignmentLinkRecord[]>;
  /** Файлы, привязанные к заданию: нужны, чтобы не привязать чужой файл. */
  findUnattachedFiles(fileIds: readonly string[]): Promise<{ id: string }[]>;
  countStudents(studyGroupId: string, onDate: string): Promise<number>;
  countSubmissions(assignmentIds: readonly string[]): Promise<Map<string, number>>;
  isTeacherOfLesson(lessonId: string, userId: string): Promise<boolean>;
  /** Ведёт ли преподаватель занятия этой группы по назначению. */
  isAssignedToGroup(studyGroupId: string, userId: string): Promise<boolean>;
}

export function createHomeworkRepository(db: Executor): HomeworkRepository {
  const selection = {
    id: homeworkAssignment.id,
    lessonId: homeworkAssignment.lessonId,
    text: homeworkAssignment.text,
    dueOn: homeworkAssignment.dueOn,
    visibleUntil: homeworkAssignment.visibleUntil,
    createdAt: homeworkAssignment.createdAt,
    lessonDate: lessonTable.lessonDate,
    lessonTeacherUserId: lessonTable.teacherUserId,
    studyGroupId: lessonTable.studyGroupId,
    groupName: studyGroup.name,
    subjectId: lessonTable.subjectId,
    subjectName: subject.name,
    subjectShortName: subject.shortName,
  };

  const base = () =>
    db
      .select(selection)
      .from(homeworkAssignment)
      .innerJoin(lessonTable, eq(lessonTable.id, homeworkAssignment.lessonId))
      .innerJoin(studyGroup, eq(studyGroup.id, lessonTable.studyGroupId))
      .innerJoin(subject, eq(subject.id, lessonTable.subjectId));

  return {
    async createAssignment(input) {
      const rows = await db
        .insert(homeworkAssignment)
        .values({
          lessonId: input.lessonId,
          text: input.text,
          dueOn: input.dueOn,
          visibleUntil: input.visibleUntil,
          createdBy: input.createdBy,
        })
        .returning({ id: homeworkAssignment.id });

      return { id: rows[0]!.id };
    },

    async updateAssignment(id, input) {
      await db
        .update(homeworkAssignment)
        .set({
          ...(input.text === undefined ? {} : { text: input.text }),
          ...(input.dueOn === undefined ? {} : { dueOn: input.dueOn }),
          ...(input.visibleUntil === undefined ? {} : { visibleUntil: input.visibleUntil }),
          updatedAt: new Date(),
        })
        .where(eq(homeworkAssignment.id, id));
    },

    async softDeleteAssignment(id, actorUserId) {
      await db
        .update(homeworkAssignment)
        .set({ deletedAt: new Date(), deletedBy: actorUserId })
        .where(eq(homeworkAssignment.id, id));
    },

    async findAssignment(id) {
      const rows = await base()
        .where(and(eq(homeworkAssignment.id, id), isNull(homeworkAssignment.deletedAt)))
        .limit(1);

      return rows[0] ?? null;
    },

    async listByLessonIds(lessonIds) {
      if (lessonIds.length === 0) return [];

      return base().where(
        and(
          inArray(homeworkAssignment.lessonId, [...lessonIds]),
          isNull(homeworkAssignment.deletedAt),
        ),
      );
    },

    async listCandidates(input) {
      /**
       * Кандидаты: задания уроков этой группы, дата урока не позже верхней границы.
       *
       * Условие «не позже» отсекает будущее, а тонкую проверку видимости (не раньше, чем
       * задали; не позже `visible_until`) делает домен — правило живёт в одном месте.
       */
      return base().where(
        and(
          eq(lessonTable.studyGroupId, input.studyGroupId),
          sql`${lessonTable.lessonDate} <= ${input.toDate}`,
          isNull(homeworkAssignment.deletedAt),
          sql`(${homeworkAssignment.visibleUntil} is null or ${homeworkAssignment.visibleUntil} >= ${input.fromDate})`,
        ),
      );
    },

    async addFiles(assignmentId, fileIds) {
      if (fileIds.length === 0) return;

      await db
        .update(homeworkAssignmentFile)
        .set({ assignmentId })
        .where(inArray(homeworkAssignmentFile.id, [...fileIds]));
    },

    async listFiles(assignmentIds) {
      if (assignmentIds.length === 0) return [];

      return db
        .select()
        .from(homeworkAssignmentFile)
        .where(inArray(homeworkAssignmentFile.assignmentId, [...assignmentIds]));
    },

    async replaceLinks(assignmentId, links) {
      await db.delete(homeworkLink).where(eq(homeworkLink.assignmentId, assignmentId));

      if (links.length === 0) return;

      await db
        .insert(homeworkLink)
        .values(links.map((link) => ({ assignmentId, url: link.url, title: link.title })));
    },

    async listLinks(assignmentIds) {
      if (assignmentIds.length === 0) return [];

      const rows = await db
        .select()
        .from(homeworkLink)
        .where(inArray(homeworkLink.assignmentId, [...assignmentIds]));

      /** Ссылка принадлежит либо заданию, либо решению: здесь нужны только задания. */
      return rows.flatMap((row) =>
        row.assignmentId === null
          ? []
          : [{ id: row.id, assignmentId: row.assignmentId, url: row.url, title: row.title }],
      );
    },

    /**
     * Файлы, ещё не привязанные к заданию.
     *
     * Проверка нужна, чтобы нельзя было привязать к своему заданию **чужой** файл, зная его
     * идентификатор: привязка идёт только по файлам без владельца, загруженным этим же
     * человеком (проверку загрузчика делает сервис).
     */
    async findUnattachedFiles(fileIds) {
      if (fileIds.length === 0) return [];

      return db
        .select({ id: homeworkAssignmentFile.id })
        .from(homeworkAssignmentFile)
        .where(
          and(
            inArray(homeworkAssignmentFile.id, [...fileIds]),
            isNull(homeworkAssignmentFile.assignmentId),
            isNull(homeworkAssignmentFile.deletedAt),
          ),
        );
    },

    async countStudents(studyGroupId, onDate) {
      const rows = await db.execute(sql`
        select count(*)::int as total
        from enrollment
        where study_group_id = ${studyGroupId}
          and joined_on <= ${onDate}
          and (left_on is null or left_on >= ${onDate})
      `);

      const first = (rows as unknown as { total: number }[])[0];
      return first?.total ?? 0;
    },

    async countSubmissions(assignmentIds) {
      if (assignmentIds.length === 0) return new Map();

      /**
       * Только параметризованный запрос: идентификаторы приходят из запроса клиента, и
       * склейка строки дала бы SQL-инъекцию.
       */
      const rows = await db
        .select({
          assignmentId: homeworkSubmission.assignmentId,
          total: sql<number>`count(*)::int`,
        })
        .from(homeworkSubmission)
        .where(
          and(
            inArray(homeworkSubmission.assignmentId, [...assignmentIds]),
            isNull(homeworkSubmission.deletedAt),
          ),
        )
        .groupBy(homeworkSubmission.assignmentId);

      return new Map(rows.map((row) => [row.assignmentId, row.total]));
    },

    async isTeacherOfLesson(lessonId, userId) {
      const rows = await db
        .select({ id: lessonTable.id })
        .from(lessonTable)
        .where(and(eq(lessonTable.id, lessonId), eq(lessonTable.teacherUserId, userId)))
        .limit(1);

      return rows.length > 0;
    },

    async isAssignedToGroup(studyGroupId, userId) {
      const rows = await db
        .select({ id: teachingAssignment.id })
        .from(teachingAssignment)
        .where(
          and(
            eq(teachingAssignment.studyGroupId, studyGroupId),
            eq(teachingAssignment.teacherUserId, userId),
          ),
        )
        .limit(1);

      return rows.length > 0;
    },
  };
}
