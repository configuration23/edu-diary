import type { FastifyPluginAsync } from 'fastify';

/**
 * Публичный интерфейс модуля `staffing`.
 *
 * Этап 2: назначения «преподаватель ↔ предмет ↔ группа». Этап 3 добавит сюда
 * замены преподавателя и просмотр расписания с учётом замен.
 */

export { teachingAssignment } from './staffing.schema';

/** Регистрация маршрутов модуля; наполняется на Шаге 4 вместе с сервисом. */
export function createStaffingModule(): FastifyPluginAsync {
  return async () => {};
}
