import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';

import type { Executor } from '../../shared/db/client';
import { studyGroup, subject } from '../academics';
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
  /** Задание урока: показывается в журнале. */
  findByLessonId(lessonId: string): Promise<AssignmentWithContext | null>;
  /**
   * Задания группы, которые могут быть видны.
   *
   * Отбор кандидатов: задания уроков этой группы, дата урока **не позже** проверяемой даты,
   * и либо задание этого урока, либо «продолжительное» с `visible_until` не раньше неё.
   * Точную проверку видимости делает домен — правило остаётся в одном месте.
   */
  listCandidates(input: {
    studyGroupId: string;
    lessonIds: readonly string[];
    onDate: string;
  }): Promise<AssignmentWithContext[]>;
  addFiles(assignmentId: string, fileIds: readonly string[]): Promise<void>;
  listFiles(assignmentIds: readonly string[]): Promise<AssignmentFileRecord[]>;
  replaceLinks(
    assignmentId: string,
    links: readonly { url: string; title: string | null }[],
  ): Promise<void>;
  listLinks(assignmentIds: readonly string[]): Promise<AssignmentLinkRecord[]>;
  /**
   * Файлы, которые ещё ни к чему не привязаны **и загружены этим же человеком**.
   *
   * Проверка загрузчика обязательна: иначе, зная чужой идентификатор, можно было бы
   * привязать к своему заданию чужой файл.
   */
  findUnattachedFiles(input: {
    fileIds: readonly string[];
    uploadedBy: string;
  }): Promise<{ id: string }[]>;
  countStudents(studyGroupId: string, onDate: string): Promise<number>;
  countSubmissions(assignmentIds: readonly string[]): Promise<Map<string, number>>;
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

    async findByLessonId(lessonId) {
      const rows = await base()
        .where(and(eq(homeworkAssignment.lessonId, lessonId), isNull(homeworkAssignment.deletedAt)))
        .limit(1);

      return rows[0] ?? null;
    },

    async listCandidates(input) {
      if (input.lessonIds.length === 0) return [];

      return base().where(
        and(
          eq(lessonTable.studyGroupId, input.studyGroupId),
          isNull(homeworkAssignment.deletedAt),
          sql`${lessonTable.lessonDate} <= ${input.onDate}`,
          /**
           * Кандидат — задание одного из уроков **или** «продолжительное» задание,
           * видимое на эту дату. Собираем через `inArray`/`gte`, без склейки SQL: значения
           * приходят из запроса клиента.
           */
          or(
            inArray(homeworkAssignment.lessonId, [...input.lessonIds]),
            gte(homeworkAssignment.visibleUntil, input.onDate),
          ),
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

    async findUnattachedFiles(input) {
      if (input.fileIds.length === 0) return [];

      return db
        .select({ id: homeworkAssignmentFile.id })
        .from(homeworkAssignmentFile)
        .where(
          and(
            inArray(homeworkAssignmentFile.id, [...input.fileIds]),
            eq(homeworkAssignmentFile.uploadedBy, input.uploadedBy),
            isNull(homeworkAssignmentFile.deletedAt),
          ),
        );
    },

    async countStudents(studyGroupId, onDate) {
      /** Только параметризованный запрос: значения приходят из запроса клиента. */
      const rows = await db.execute(sql`
        select count(*)::int as total
        from student_enrollment
        where study_group_id = ${studyGroupId}
          and joined_on <= ${onDate}
          and (left_on is null or left_on >= ${onDate})
      `);

      const first = (rows as unknown as { total: number }[])[0];
      return first?.total ?? 0;
    },

    async countSubmissions(assignmentIds) {
      if (assignmentIds.length === 0) return new Map();

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
  };
}

/** Порядок вывода: свежие задания первыми. */
export const HOMEWORK_ORDER = desc(homeworkAssignment.createdAt);
