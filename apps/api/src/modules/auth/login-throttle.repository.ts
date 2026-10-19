import { sql } from 'drizzle-orm';
import { pgTable, integer, text, timestamp } from 'drizzle-orm/pg-core';

import type { Database, Executor } from '../../shared/db/client';

/**
 * Счётчик неудачных входов по адресу.
 *
 * Ограничение по учётной записи не ловит перебор «по словарю логинов»: каждая учётка получает свои
 * пять попыток. Здесь счётчик на адрес — он и закрывает такую схему.
 *
 * Инкремент атомарный (`insert ... on conflict do update`), поэтому параллельные попытки не теряются.
 */
export const loginThrottle = pgTable('login_throttle', {
  key: text('key').primaryKey(),
  failures: integer('failures').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Сколько неудач с одного адреса разрешено за окно. */
export const IP_FAILURES_LIMIT = 20;
/** Окно подсчёта. */
export const IP_FAILURES_WINDOW_MINUTES = 15;
/** Блокировка адреса после превышения. */
export const IP_LOCK_MINUTES = 15;

export interface ThrottleState {
  lockedUntil: Date | null;
  failures: number;
}

export interface LoginThrottleRepository {
  /** Текущее состояние адреса: блокировка и счётчик за окно. */
  state(key: string): Promise<ThrottleState>;
  /** Записать неудачу: атомарный инкремент с учётом окна. */
  registerFailure(key: string): Promise<ThrottleState>;
  /** Успешный вход сбрасывает счётчик. */
  reset(key: string): Promise<void>;
}

export function createLoginThrottleRepository(db: Database): LoginThrottleRepository {
  const windowInterval = sql.raw(`interval '${IP_FAILURES_WINDOW_MINUTES} minutes'`);
  const lockInterval = sql.raw(`interval '${IP_LOCK_MINUTES} minutes'`);

  return {
    async state(key: string): Promise<ThrottleState> {
      const rows = await db.orm
        .select()
        .from(loginThrottle)
        .where(sql`${loginThrottle.key} = ${key}`)
        .limit(1);

      const row = rows[0];
      if (row === undefined) return { lockedUntil: null, failures: 0 };

      const fresh = row.updatedAt.getTime() > Date.now() - IP_FAILURES_WINDOW_MINUTES * 60_000;

      return {
        lockedUntil:
          row.lockedUntil !== null && row.lockedUntil.getTime() > Date.now()
            ? row.lockedUntil
            : null,
        failures: fresh ? row.failures : 0,
      };
    },

    async registerFailure(key: string): Promise<ThrottleState> {
      /**
       * Одна инструкция: инкремент и, при превышении, блокировка. Так гонка параллельных попыток не
       * даёт «потерять» ни одну из них.
       */
      const rows = await db.orm.execute<{ failures: number; locked_until: Date | null }>(sql`
        insert into login_throttle (key, failures, updated_at)
        values (${key}, 1, now())
        on conflict (key) do update
          set failures = case
                when login_throttle.updated_at < now() - ${windowInterval} then 1
                else login_throttle.failures + 1
              end,
              locked_until = case
                when (case
                        when login_throttle.updated_at < now() - ${windowInterval} then 1
                        else login_throttle.failures + 1
                      end) >= ${IP_FAILURES_LIMIT}
                  then now() + ${lockInterval}
                else login_throttle.locked_until
              end,
              updated_at = now()
        returning failures, locked_until
      `);

      const row = rows[0];
      if (row === undefined) return { lockedUntil: null, failures: 0 };

      return { failures: row.failures, lockedUntil: row.locked_until };
    },

    async reset(key: string): Promise<void> {
      await db.orm.execute(sql`delete from login_throttle where key = ${key}`);
    },
  };
}

/** Ключ счётчика по адресу. */
export function ipThrottleKey(ip: string | null): string {
  return `ip:${ip ?? 'unknown'}`;
}

export type { Executor };
