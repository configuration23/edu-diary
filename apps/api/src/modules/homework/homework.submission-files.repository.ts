import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { Executor } from '../../shared/db/client';
import { homeworkSubmissionFile } from './homework.schema';

/**
 * Вложения решений: запись метаданных.
 *
 * Отдельно от материалов задания: это **разные документы разного автора**. Материал задания
 * прикладывает преподаватель, файл решения — ученик, и смешивать их в одной таблице значило
 * бы путать, чей это файл, при проверке прав.
 */

export interface PendingSubmissionFile {
  id: string;
  submissionId: string | null;
  storageKey: string;
  originalName: string;
  sizeBytes: number;
  mimeType: string;
  uploadedBy: string | null;
}

export interface SubmissionFileRepository {
  createPending(input: {
    storageKey: string;
    originalName: string;
    sizeBytes: number;
    mimeType: string;
    uploadedBy: string;
  }): Promise<{ id: string }>;
  findById(id: string): Promise<PendingSubmissionFile | null>;
  findUnattached(input: {
    fileIds: readonly string[];
    uploadedBy: string;
  }): Promise<{ id: string; originalName: string }[]>;
}

export function createSubmissionFileRepository(db: Executor): SubmissionFileRepository {
  const selection = {
    id: homeworkSubmissionFile.id,
    submissionId: homeworkSubmissionFile.submissionId,
    storageKey: homeworkSubmissionFile.storageKey,
    originalName: homeworkSubmissionFile.originalName,
    sizeBytes: homeworkSubmissionFile.sizeBytes,
    mimeType: homeworkSubmissionFile.mimeType,
    uploadedBy: homeworkSubmissionFile.uploadedBy,
  };

  return {
    async createPending(input) {
      const rows = await db
        .insert(homeworkSubmissionFile)
        .values({
          submissionId: null,
          storageKey: input.storageKey,
          originalName: input.originalName,
          sizeBytes: input.sizeBytes,
          mimeType: input.mimeType,
          uploadedBy: input.uploadedBy,
        })
        .returning({ id: homeworkSubmissionFile.id });

      return { id: rows[0]!.id };
    },

    async findById(id) {
      const rows = await db
        .select(selection)
        .from(homeworkSubmissionFile)
        .where(and(eq(homeworkSubmissionFile.id, id), isNull(homeworkSubmissionFile.deletedAt)))
        .limit(1);

      return rows[0] ?? null;
    },

    async findUnattached(input) {
      if (input.fileIds.length === 0) return [];

      return db
        .select({
          id: homeworkSubmissionFile.id,
          originalName: homeworkSubmissionFile.originalName,
        })
        .from(homeworkSubmissionFile)
        .where(
          and(
            inArray(homeworkSubmissionFile.id, [...input.fileIds]),
            eq(homeworkSubmissionFile.uploadedBy, input.uploadedBy),
            isNull(homeworkSubmissionFile.submissionId),
            isNull(homeworkSubmissionFile.deletedAt),
          ),
        );
    },
  };
}
