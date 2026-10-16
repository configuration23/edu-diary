import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { Executor } from '../../shared/db/client';
import { student, studyGroup, subject } from '../academics';
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
 * Модель: у задания есть **урок-срок** (`dueLessonId`) — до какого занятия оно задано. Дат
 * нет: учитель выбирает урок из ближайших, а по умолчанию подставляется следующий урок того
 * же предмета и группы. Ученик видит задание в уроке-сроке и во всех промежуточных уроках,
 * поэтому «долгая домашка и короткая рядом» не мешают друг другу — у каждой свой срок.
 */

export interface AssignmentWithContext {
  id: string;
  /** Урок, на котором задание задано: «домашняя работа от 8-го». */
  lessonId: string;
  lessonDate: string;
  /** Урок-срок: до какого занятия задано. */
  dueLessonId: string;
  dueLessonDate: string;
  text: string;
  createdAt: Date;
  lessonTeacherUserId: string | null;
  studyGroupId: string;
  groupName: string;
  subjectId: string;
  subjectName: string;
  subjectShortName: string | null;
}

export interface AssignmentFileRecord {
  id: string;
  assignmentId: string | null;
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
    dueLessonId: string;
    text: string;
    createdBy: string;
  }): Promise<{ id: string }>;
  updateAssignment(id: string, input: { text?: string; dueLessonId?: string }): Promise<void>;
  softDeleteAssignment(id: string, actorUserId: string): Promise<void>;
  findAssignment(id: string): Promise<AssignmentWithContext | null>;
  /** Задания, **заданные** на этом уроке: блок для учителя. */
  listByLessonId(lessonId: string): Promise<AssignmentWithContext[]>;
  /** Задания, **сдать которые** нужно к этому уроку: то, что видит ученик. */
  listByDueLessonId(dueLessonId: string): Promise<AssignmentWithContext[]>;
  /**
   * Задания, срок которых — один из этих уроков.
   *
   * Так ученик получает свои задания на дату: список уроков дня даёт вызывающая сторона.
   */
  listByDueLessonIds(dueLessonIds: readonly string[]): Promise<AssignmentWithContext[]>;
  /** Задания, **заданные** на этих уроках: отметка для расписания. */
  listByLessonIdsAssigned(lessonIds: readonly string[]): Promise<AssignmentWithContext[]>;
  /**
   * Какие из этих заданий сдал **сам смотрящий**.
   *
   * Нужно ученику: в расписании он должен видеть не только «задано», но и «сдано». Берём
   * именно его сдачи, а не общий счётчик, — иначе чужие работы попадали бы в отметку.
   */
  countSubmissionsByViewer(input: {
    assignmentIds: readonly string[];
    viewerUserId: string;
  }): Promise<Set<string>>;
  addFiles(assignmentId: string, fileIds: readonly string[]): Promise<void>;
  listFiles(assignmentIds: readonly string[]): Promise<AssignmentFileRecord[]>;
  replaceLinks(
    assignmentId: string,
    links: readonly { url: string; title: string | null }[],
  ): Promise<void>;
  listLinks(assignmentIds: readonly string[]): Promise<AssignmentLinkRecord[]>;
  countStudents(studyGroupId: string, onDate: string): Promise<number>;
  countSubmissions(assignmentIds: readonly string[]): Promise<Map<string, number>>;
  /** Ведёт ли этот преподаватель урок: по нему проверяется право на файл задания. */
  isTeacherOfLesson(lessonId: string, userId: string): Promise<boolean>;
}

export function createHomeworkRepository(db: Executor): HomeworkRepository {
  const selection = {
    id: homeworkAssignment.id,
    lessonId: homeworkAssignment.lessonId,
    lessonDate: lessonTable.lessonDate,
    dueLessonId: homeworkAssignment.dueLessonId,
    /** Дата урока-срока: по ней ученик видит, «до какого числа» сдать. */
    dueLessonDate: sql<string>`(
      select due.lesson_date from lesson as due where due.id = ${homeworkAssignment.dueLessonId}
    )`,
    text: homeworkAssignment.text,
    createdAt: homeworkAssignment.createdAt,
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
          dueLessonId: input.dueLessonId,
          text: input.text,
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
          ...(input.dueLessonId === undefined ? {} : { dueLessonId: input.dueLessonId }),
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

    async listByLessonId(lessonId) {
      return base().where(
        and(eq(homeworkAssignment.lessonId, lessonId), isNull(homeworkAssignment.deletedAt)),
      );
    },

    async listByDueLessonId(dueLessonId) {
      return base().where(
        and(eq(homeworkAssignment.dueLessonId, dueLessonId), isNull(homeworkAssignment.deletedAt)),
      );
    },

    async listByDueLessonIds(dueLessonIds) {
      if (dueLessonIds.length === 0) return [];

      return base().where(
        and(
          inArray(homeworkAssignment.dueLessonId, [...dueLessonIds]),
          isNull(homeworkAssignment.deletedAt),
        ),
      );
    },

    async listByLessonIdsAssigned(lessonIds) {
      if (lessonIds.length === 0) return [];

      return base().where(
        and(
          inArray(homeworkAssignment.lessonId, [...lessonIds]),
          isNull(homeworkAssignment.deletedAt),
        ),
      );
    },

    async countSubmissionsByViewer(input) {
      if (input.assignmentIds.length === 0) return new Set<string>();

      /**
       * Соединяем сдачу с **карточкой ученика этого пользователя**: у смотрящего должна быть
       * своя карточка, иначе сдавать ему нечем. Так «сдано» в расписании относится именно к
       * нему, а не к классу.
       */
      const rows = await db
        .select({ assignmentId: homeworkSubmission.assignmentId })
        .from(homeworkSubmission)
        .innerJoin(student, eq(student.id, homeworkSubmission.studentId))
        .where(
          and(
            inArray(homeworkSubmission.assignmentId, [...input.assignmentIds]),
            eq(student.userId, input.viewerUserId),
            isNull(homeworkSubmission.deletedAt),
          ),
        );

      return new Set(rows.map((row) => row.assignmentId));
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

    async isTeacherOfLesson(lessonId, userId) {
      const rows = await db
        .select({ id: lessonTable.id })
        .from(lessonTable)
        .where(and(eq(lessonTable.id, lessonId), eq(lessonTable.teacherUserId, userId)))
        .limit(1);

      return rows.length > 0;
    },
  };
}
