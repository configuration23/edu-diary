import { toIsoDate } from '@edu-diary/domain';

import { AppError } from '../../shared/errors';
import type { AssignmentWithContext } from './homework.repository';
import type { SubmissionRecord, SubmissionRepository } from './homework.submissions.repository';

/**
 * Сдача решения учеником.
 *
 * Правила владельца, которые здесь и живут:
 *
 * - **одна попытка**: черновика нет, решение отправляется один раз. Пересдача обсуждается,
 *   поэтому попытка считается в сервисе, а не ограничением базы;
 * - **после срока сдавать можно**, но сдача помечается опоздавшей: не наказываем за
 *   задержку, но показываем факт;
 * - **факт сдачи не ставит оценку**: оценку преподаватель ставит сам в журнале.
 *
 * Сервис не решает, чьё это задание: проверку доступа выполняет вызывающая сторона, у
 * которой есть уроки и состав групп. Здесь — только правила сдачи.
 */

export interface SubmissionView {
  id: string;
  assignmentId: string;
  studentId: string;
  studentName: string;
  text: string;
  submittedAt: string;
  /** Сдано позже срока: показываем пометкой, но не запрещаем. */
  isLate: boolean;
  files: {
    id: string;
    originalName: string;
    sizeBytes: number;
    mimeType: string;
  }[];
}

export interface SubmissionService {
  /**
   * Что уже сдал ученик: нужно, чтобы показать состояние и не сдать дважды.
   *
   * Срок передаётся отдельно: по нему видно опоздание, а само решение срока не хранит.
   */
  findOwn(input: {
    assignmentId: string;
    studentId: string;
    /** Дата урока-срока: по ней считается опоздание. */
    dueLessonDate: string;
  }): Promise<SubmissionView | null>;
  /** Список сдавших для учителя: в нём же видно опоздавших. */
  list(input: { assignment: AssignmentWithContext }): Promise<SubmissionView[]>;
  submit(input: {
    assignment: AssignmentWithContext;
    studentId: string;
    viewerUserId: string;
    text: string;
    fileIds: readonly string[];
  }): Promise<{ id: string }>;
}

export function createSubmissionService(dependencies: {
  repository: SubmissionRepository;
}): SubmissionService {
  const { repository } = dependencies;

  const viewOf = (record: SubmissionRecord, dueLessonDate: string): SubmissionView => ({
    id: record.id,
    assignmentId: record.assignmentId,
    studentId: record.studentId,
    studentName: record.studentName,
    text: record.text,
    submittedAt: record.submittedAt.toISOString(),
    /**
     * Опоздание сравниваем **по календарным датам**: сданное в день срока опозданием не
     * считается, и часовой пояс на это не влияет.
     */
    /**
     * Опоздание — по **дате урока-срока**: задание к занятию 15-го, принесли 16-го —
     * опоздал. Принимаем, но помечаем (решение владельца).
     */
    isLate: toIsoDate(record.submittedAt) > dueLessonDate,
    files: record.files.map((file) => ({
      id: file.id,
      originalName: file.originalName,
      sizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
    })),
  });

  return {
    async findOwn(input) {
      const found = await repository.findByAssignmentAndStudent(
        input.assignmentId,
        input.studentId,
      );

      return found === null ? null : viewOf(found, input.dueLessonDate);
    },

    async list(input) {
      const records = await repository.listByAssignment(input.assignment.id);
      return records.map((record) => viewOf(record, input.assignment.dueLessonDate));
    },

    async submit(input) {
      /**
       * Проверка перед записью, а не только в интерфейсе: ученик может отправить форму
       * дважды (медленная сеть, повторное нажатие), и второе решение не должно появиться.
       */
      const existing = await repository.findByAssignmentAndStudent(
        input.assignment.id,
        input.studentId,
      );

      if (existing !== null) {
        throw new AppError(
          'CONFLICT',
          'Решение уже отправлено. Пересдача появится позже — сейчас попытка одна',
        );
      }

      if (input.text.trim() === '' && input.fileIds.length === 0) {
        throw new AppError('VALIDATION_FAILED', 'Решение пустое: нужен текст или файл');
      }

      return repository.create({
        assignmentId: input.assignment.id,
        studentId: input.studentId,
        text: input.text,
        fileIds: input.fileIds,
        /** По этому значению запрос привяжет только свои файлы. */
        uploadedBy: input.viewerUserId,
      });
    },
  };
}
