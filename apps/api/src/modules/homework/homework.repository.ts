/**
 * Доступ к данным домашних заданий (Этап 5, шаг 2).
 *
 * SQL живёт только здесь (`ARCHITECTURE.md` §3). Задание всегда читается вместе с уроком:
 * группа, предмет и преподаватель нужны и для прав, и для показа, и брать их отдельными
 * запросами значило бы плодить запросы на каждый экран.
 *
 * Сейчас здесь **только контракты доступа к данным**: реализация появится вместе с
 * сервисом заданий. Причина, по которой это разделено явно: файл, не подключённый к
 * `index.ts` модуля, **не проверяется** сборкой и типами — именно так незавершённый
 * репозиторий попал в коммит и сломал проверку типов в CI, а локально ошибка не была
 * видна, потому что в рабочем дереве файл был уже исправлен.
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
