/**
 * Публичный интерфейс модуля `homework` (Этап 5).
 *
 * Домашние задания: таблицы, доступ к данным, правила и маршруты. Таблицы отдаются наружу
 * для миграций и сборки приложения; другие модули работают с заданиями через сервис.
 */

export {
  homeworkAssignment,
  homeworkAssignmentFile,
  homeworkLink,
  homeworkSubmission,
  homeworkSubmissionFile,
} from './homework.schema';
export {
  createHomeworkRepository,
  type AssignmentFileRecord,
  type AssignmentLinkRecord,
  type AssignmentWithContext,
  type HomeworkRepository,
} from './homework.repository';
export {
  createHomeworkService,
  type HomeworkDetail,
  type HomeworkService,
  type HomeworkServiceDependencies,
  type HomeworkViewer,
} from './homework.service';
export { createHomeworkModule, type HomeworkModuleDependencies } from './homework.routes';
