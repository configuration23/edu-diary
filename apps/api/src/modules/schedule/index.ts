import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../shared/db/client';
import type { AuditService } from '../audit';

/**
 * Публичный интерфейс модуля `schedule` (Этап 3).
 *
 * Модуль отвечает за расписание и уроки: шаблон по группе с датой начала и
 * (необязательным) окончанием, исключения на конкретную дату — отмена, перенос,
 * замена, — порождённые уроки и замены преподавателя на урок или диапазон дат.
 *
 * Состояние: схема БД и каталог прав готовы (шаги 3 и 5 плана этапа), сервис,
 * маршруты и интерфейс — следующие шаги (`docs/PHASE-3-PLAN.md`). Поэтому здесь
 * пока только описание схемы и пустой набор маршрутов: раздел не отвечает
 * `404`-заглушками, а просто ещё не зарегистрирован.
 */

export { lesson, scheduleEntry, scheduleException, substitution } from './schedule.schema';

/**
 * Маршруты расписания.
 *
 * Регистрируется в `app.ts` сразу: когда появится сервис, сюда добавятся
 * обработчики, и приложение соберётся тем же кодом, без правок в композиции.
 */
export function createScheduleModule(_dependencies: {
  /** Сервис расписания появится на следующем шаге этапа. */
  service?: unknown;
}): FastifyPluginAsync {
  return async () => {
    // Маршруты добавляются вместе с сервисом (шаг 4 плана).
  };
}

/**
 * Сборка сервиса расписания.
 *
 * Заглушка до шага 4: сообщение говорит, что именно осталось сделать, вместо
 * невнятной ошибки «undefined is not a function».
 */
export function buildScheduleService(_dependencies: { db: Database; audit: AuditService }): never {
  throw new Error(
    'Сервис расписания ещё не реализован: остались шаги 4, 6 и 7 плана Этапа 3 (docs/PHASE-3-PLAN.md)',
  );
}
