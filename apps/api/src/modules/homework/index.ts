/**
 * Публичный интерфейс модуля `homework` (Этап 5).
 *
 * Задания, решения и вложения. Таблицы модуля отдаются наружу: их читают миграции и
 * сборка приложения, а другие модули работают с заданиями через сервис, а не через схему.
 */

export {
  homeworkAssignment,
  homeworkAssignmentFile,
  homeworkLink,
  homeworkSubmission,
  homeworkSubmissionFile,
} from './homework.schema';
