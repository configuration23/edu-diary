import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { Executor } from '../../shared/db/client';
import { student } from '../academics';
import { homeworkSubmission, homeworkSubmissionFile } from './homework.schema';

/**
 * Решения учеников: данные.
 *
 * Отдельно от заданий: у решения своя жизнь — своё время сдачи, свои вложения и своя
 * проверка на опоздание. Смешивать их в одном репозитории значило бы держать в одном файле
 * две разные ответственности.
 */

export interface SubmissionRecord {
  id: string;
  assignmentId: string;
  studentId: string;
  studentName: string;
  text: string;
  submittedAt: Date;
  files: SubmissionFileRecord[];
}

export interface SubmissionFileRecord {
  id: string;
  storageKey: string;
  originalName: string;
  sizeBytes: number;
  mimeType: string;
  uploadedBy: string | null;
}

export interface SubmissionRepository {
  /** Ученик по учётной записи: у смотрящего должна быть своя карточка ученика. */
  findStudentByUserId(userId: string): Promise<{ id: string; fullName: string } | null>;
  /** Решения задания: для списка сдавших. */
  listByAssignment(assignmentId: string): Promise<SubmissionRecord[]>;
  /** Решение конкретного ученика: чтобы не сдать дважды. */
  findByAssignmentAndStudent(
    assignmentId: string,
    studentId: string,
  ): Promise<SubmissionRecord | null>;
  create(input: {
    assignmentId: string;
    studentId: string;
    text: string;
    fileIds: readonly string[];
    /** Кто сдаёт: по нему проверяется, что файлы — свои. */
    uploadedBy: string;
  }): Promise<{ id: string }>;
  /** Свои, ещё не привязанные файлы решения: только их можно приложить. */
  findUnattachedFiles(input: {
    fileIds: readonly string[];
    uploadedBy: string;
  }): Promise<SubmissionFileRecord[]>;
  attachFiles(submissionId: string, fileIds: readonly string[]): Promise<void>;
  /** Файл решения: по нему проверяются права на скачивание. */
  findFile(fileId: string): Promise<{
    id: string;
    assignmentId: string;
    studentId: string;
    storageKey: string;
    originalName: string;
    mimeType: string;
    uploadedBy: string | null;
  } | null>;
}

export function createSubmissionRepository(db: Executor): SubmissionRepository {
  const fileSelection = {
    id: homeworkSubmissionFile.id,
    submissionId: homeworkSubmissionFile.submissionId,
    storageKey: homeworkSubmissionFile.storageKey,
    originalName: homeworkSubmissionFile.originalName,
    sizeBytes: homeworkSubmissionFile.sizeBytes,
    mimeType: homeworkSubmissionFile.mimeType,
    uploadedBy: homeworkSubmissionFile.uploadedBy,
  };

  /**
   * Файлы решений по их идентификаторам.
   *
   * Фильтр именно по submissionId: раньше здесь стояло поле решения, и файлы не находились —
   * решение сдавалось, но без вложений.
   */
  const loadFiles = async (submissionIds: readonly string[]) => {
    if (submissionIds.length === 0) return [];

    return db
      .select(fileSelection)
      .from(homeworkSubmissionFile)
      .where(
        and(
          inArray(homeworkSubmissionFile.submissionId, [...submissionIds]),
          isNull(homeworkSubmissionFile.deletedAt),
        ),
      );
  };

  return {
    async findStudentByUserId(userId) {
      const rows = await db
        .select({ id: student.id, fullName: student.fullName })
        .from(student)
        .where(eq(student.userId, userId))
        .limit(1);

      return rows[0] ?? null;
    },

    async listByAssignment(assignmentId) {
      const rows = await db
        .select({
          id: homeworkSubmission.id,
          assignmentId: homeworkSubmission.assignmentId,
          studentId: homeworkSubmission.studentId,
          studentName: student.fullName,
          text: homeworkSubmission.text,
          submittedAt: homeworkSubmission.submittedAt,
        })
        .from(homeworkSubmission)
        .innerJoin(student, eq(student.id, homeworkSubmission.studentId))
        .where(
          and(
            eq(homeworkSubmission.assignmentId, assignmentId),
            isNull(homeworkSubmission.deletedAt),
          ),
        );

      const files = await loadFiles(rows.map((row) => row.id));

      return rows.map((row) => ({
        ...row,
        files: files
          .filter((file) => file.submissionId === row.id)
          .map((file) => ({
            id: file.id,
            storageKey: file.storageKey,
            originalName: file.originalName,
            sizeBytes: file.sizeBytes,
            mimeType: file.mimeType,
            uploadedBy: file.uploadedBy,
          })),
      }));
    },

    async findByAssignmentAndStudent(assignmentId, studentId) {
      const rows = await db
        .select({
          id: homeworkSubmission.id,
          assignmentId: homeworkSubmission.assignmentId,
          studentId: homeworkSubmission.studentId,
          studentName: student.fullName,
          text: homeworkSubmission.text,
          submittedAt: homeworkSubmission.submittedAt,
        })
        .from(homeworkSubmission)
        .innerJoin(student, eq(student.id, homeworkSubmission.studentId))
        .where(
          and(
            eq(homeworkSubmission.assignmentId, assignmentId),
            eq(homeworkSubmission.studentId, studentId),
            isNull(homeworkSubmission.deletedAt),
          ),
        )
        .limit(1);

      const found = rows[0];
      if (found === undefined) return null;

      const files = await loadFiles([found.id]);

      return {
        ...found,
        files: files.map((file) => ({
          id: file.id,
          storageKey: file.storageKey,
          originalName: file.originalName,
          sizeBytes: file.sizeBytes,
          mimeType: file.mimeType,
          uploadedBy: file.uploadedBy,
        })),
      };
    },

    async create(input) {
      const rows = await db
        .insert(homeworkSubmission)
        .values({
          assignmentId: input.assignmentId,
          studentId: input.studentId,
          text: input.text,
        })
        .returning({ id: homeworkSubmission.id });

      const submissionId = rows[0]!.id;

      if (input.fileIds.length > 0) {
        /**
         * Привязываем **только свои и ещё не привязанные** файлы, и это условие стоит прямо
         * в запросе: отдельная проверка «сначала нашли, потом привязали» оставляла щель
         * между двумя запросами, а здесь её нет.
         */
        await db
          .update(homeworkSubmissionFile)
          .set({ submissionId })
          .where(
            and(
              inArray(homeworkSubmissionFile.id, [...input.fileIds]),
              isNull(homeworkSubmissionFile.submissionId),
              eq(homeworkSubmissionFile.uploadedBy, input.uploadedBy),
            ),
          );
      }

      return { id: submissionId };
    },

    async findUnattachedFiles(input) {
      if (input.fileIds.length === 0) return [];

      return db
        .select(fileSelection)
        .from(homeworkSubmissionFile)
        .where(
          and(
            inArray(homeworkSubmissionFile.id, [...input.fileIds]),
            eq(homeworkSubmissionFile.uploadedBy, input.uploadedBy),
            isNull(homeworkSubmissionFile.submissionId),
            isNull(homeworkSubmissionFile.deletedAt),
          ),
        )
        .then((rows) =>
          rows.map((row) => ({
            id: row.id,
            storageKey: row.storageKey,
            originalName: row.originalName,
            sizeBytes: row.sizeBytes,
            mimeType: row.mimeType,
            uploadedBy: row.uploadedBy,
          })),
        );
    },

    async attachFiles(submissionId, fileIds) {
      if (fileIds.length === 0) return;

      await db
        .update(homeworkSubmissionFile)
        .set({ submissionId })
        .where(inArray(homeworkSubmissionFile.id, [...fileIds]));
    },

    async findFile(fileId) {
      const rows = await db
        .select({
          id: homeworkSubmissionFile.id,
          submissionId: homeworkSubmissionFile.submissionId,
          storageKey: homeworkSubmissionFile.storageKey,
          originalName: homeworkSubmissionFile.originalName,
          mimeType: homeworkSubmissionFile.mimeType,
          uploadedBy: homeworkSubmissionFile.uploadedBy,
          assignmentId: homeworkSubmission.assignmentId,
          studentId: homeworkSubmission.studentId,
        })
        .from(homeworkSubmissionFile)
        .innerJoin(
          homeworkSubmission,
          eq(homeworkSubmission.id, homeworkSubmissionFile.submissionId),
        )
        .where(and(eq(homeworkSubmissionFile.id, fileId), isNull(homeworkSubmissionFile.deletedAt)))
        .limit(1);

      const found = rows[0];
      if (found === undefined) return null;

      return {
        id: found.id,
        assignmentId: found.assignmentId,
        studentId: found.studentId,
        storageKey: found.storageKey,
        originalName: found.originalName,
        mimeType: found.mimeType,
        uploadedBy: found.uploadedBy,
      };
    },
  };
}
