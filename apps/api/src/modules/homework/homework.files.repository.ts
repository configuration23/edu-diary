import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { Executor } from '../../shared/db/client';
import { homeworkAssignmentFile } from './homework.schema';

/**
 * Вложения домашних заданий: запись метаданных.
 *
 * Сам файл лежит в хранилище — здесь только ключ и размеры. Отдельного «универсального»
 * репозитория не делаем: вложения решения ученика появятся своей таблицей и своим
 * репозиторием, и общий доступ к данным только запутал бы.
 */

export interface PendingFileRecord {
  id: string;
  /** Пусто у файла, загруженного до сохранения задания. */
  assignmentId: string | null;
  storageKey: string;
  originalName: string;
  sizeBytes: number;
  mimeType: string;
  uploadedBy: string | null;
}

export interface AssignmentFileRepository {
  /** Запомнить загруженный файл. Задание привязывается позже, когда его сохранят. */
  createPending(input: {
    storageKey: string;
    originalName: string;
    sizeBytes: number;
    mimeType: string;
    uploadedBy: string;
  }): Promise<{ id: string }>;
  findById(id: string): Promise<PendingFileRecord | null>;
  /** Свои, ещё не привязанные файлы: только их можно привязать к заданию. */
  findUnattached(input: {
    fileIds: readonly string[];
    uploadedBy: string;
  }): Promise<PendingFileRecord[]>;
  attachToAssignment(assignmentId: string, fileIds: readonly string[]): Promise<void>;
  listByAssignment(assignmentId: string): Promise<PendingFileRecord[]>;
}

export function createAssignmentFileRepository(db: Executor): AssignmentFileRepository {
  return {
    async createPending(input) {
      const rows = await db
        .insert(homeworkAssignmentFile)
        .values({
          assignmentId: null,
          storageKey: input.storageKey,
          originalName: input.originalName,
          sizeBytes: input.sizeBytes,
          mimeType: input.mimeType,
          uploadedBy: input.uploadedBy,
        })
        .returning({ id: homeworkAssignmentFile.id });

      return { id: rows[0]!.id };
    },

    async findById(id) {
      const rows = await db
        .select({
          id: homeworkAssignmentFile.id,
          assignmentId: homeworkAssignmentFile.assignmentId,
          storageKey: homeworkAssignmentFile.storageKey,
          originalName: homeworkAssignmentFile.originalName,
          sizeBytes: homeworkAssignmentFile.sizeBytes,
          mimeType: homeworkAssignmentFile.mimeType,
          uploadedBy: homeworkAssignmentFile.uploadedBy,
        })
        .from(homeworkAssignmentFile)
        .where(and(eq(homeworkAssignmentFile.id, id), isNull(homeworkAssignmentFile.deletedAt)))
        .limit(1);

      return rows[0] ?? null;
    },

    async findUnattached(input) {
      if (input.fileIds.length === 0) return [];

      return db
        .select({
          id: homeworkAssignmentFile.id,
          assignmentId: homeworkAssignmentFile.assignmentId,
          storageKey: homeworkAssignmentFile.storageKey,
          originalName: homeworkAssignmentFile.originalName,
          sizeBytes: homeworkAssignmentFile.sizeBytes,
          mimeType: homeworkAssignmentFile.mimeType,
          uploadedBy: homeworkAssignmentFile.uploadedBy,
        })
        .from(homeworkAssignmentFile)
        .where(
          and(
            inArray(homeworkAssignmentFile.id, [...input.fileIds]),
            eq(homeworkAssignmentFile.uploadedBy, input.uploadedBy),
            isNull(homeworkAssignmentFile.assignmentId),
            isNull(homeworkAssignmentFile.deletedAt),
          ),
        );
    },

    async attachToAssignment(assignmentId, fileIds) {
      if (fileIds.length === 0) return;

      await db
        .update(homeworkAssignmentFile)
        .set({ assignmentId })
        .where(inArray(homeworkAssignmentFile.id, [...fileIds]));
    },

    async listByAssignment(assignmentId) {
      return db
        .select({
          id: homeworkAssignmentFile.id,
          assignmentId: homeworkAssignmentFile.assignmentId,
          storageKey: homeworkAssignmentFile.storageKey,
          originalName: homeworkAssignmentFile.originalName,
          sizeBytes: homeworkAssignmentFile.sizeBytes,
          mimeType: homeworkAssignmentFile.mimeType,
          uploadedBy: homeworkAssignmentFile.uploadedBy,
        })
        .from(homeworkAssignmentFile)
        .where(
          and(
            eq(homeworkAssignmentFile.assignmentId, assignmentId),
            isNull(homeworkAssignmentFile.deletedAt),
          ),
        );
    },
  };
}
