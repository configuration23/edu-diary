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

/** Пороги счётчика: у адреса и у логина они разные. */
export interface ThrottlePolicy {
  threshold: number;
  baseMinutes: number;
  maxMinutes: number;
  windowMinutes: number;
}

/** Адрес: 20 неудач за 15 минут, блокировка на 15 минут. */
export const IP_POLICY: ThrottlePolicy = {
  threshold: IP_FAILURES_LIMIT,
  baseMinutes: IP_LOCK_MINUTES,
  maxMinutes: IP_LOCK_MINUTES,
  windowMinutes: IP_FAILURES_WINDOW_MINUTES,
};

/**
 * Логин: та же лестница, что у учётной записи (5, 10, 20, 40… минут).
 *
 * Считается для **любого** логина, существует он или нет: иначе по поведению блокировки видно,
 * заведена ли учётная запись — это вектор разведки перед атакой.
 */
export const USER_POLICY: ThrottlePolicy = {
  threshold: 5,
  baseMinutes: 5,
  maxMinutes: 24 * 60,
  windowMinutes: 24 * 60,
};

export interface LoginThrottleRepository {
  /** Текущее состояние ключа: блокировка и счётчик за окно. */
  state(key: string, windowMinutes: number): Promise<ThrottleState>;
  /** Записать неудачу: атомарный инкремент с учётом политики. */
  registerFailure(key: string, policy: ThrottlePolicy): Promise<ThrottleState>;
  /** Успешный вход сбрасывает счётчик. */
  reset(key: string): Promise<void>;
}

export function createLoginThrottleRepository(db: Database): LoginThrottleRepository {
  return {
    async state(key: string, windowMinutes: number): Promise<ThrottleState> {
      const rows = await db.orm
        .select()
        .from(loginThrottle)
        .where(sql`${loginThrottle.key} = ${key}`)
        .limit(1);

      const row = rows[0];
      if (row === undefined) return { lockedUntil: null, failures: 0 };

      const fresh = row.updatedAt.getTime() > Date.now() - windowMinutes * 60_000;

      return {
        lockedUntil:
          row.lockedUntil !== null && row.lockedUntil.getTime() > Date.now()
            ? row.lockedUntil
            : null,
        failures: fresh ? row.failures : 0,
      };
    },

    async registerFailure(key: string, policy: ThrottlePolicy): Promise<ThrottleState> {
      /**
       * Одна инструкция: инкремент и, при превышении, блокировка. Так гонка параллельных попыток не
       * даёт «потерять» ни одну из них.
       */
      const windowInterval = sql.raw(`interval '${policy.windowMinutes} minutes'`);
      const baseInterval = sql.raw(`interval '${policy.baseMinutes} minutes'`);

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
                      end) >= ${policy.threshold}
                  then now() + ${baseInterval} * (
                    least(
                      power(
                        2,
                        (case
                           when login_throttle.updated_at < now() - ${windowInterval} then 1
                           else login_throttle.failures + 1
                         end) - ${policy.threshold}
                      ),
                      ${policy.maxMinutes / policy.baseMinutes}
                    )
                  )::int
                else login_throttle.locked_until
              end,
              updated_at = now()
        returning failures, locked_until
      `);

      const row = rows[0];
      if (row === undefined) return { lockedUntil: null, failures: 0 };

      return {
        failures: row.failures,
        /** Сырой запрос отдаёт timestamp строкой: наружу — только Date. */
        lockedUntil: row.locked_until === null ? null : new Date(row.locked_until),
      };
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

/**
 * Ключ счётчика по логину.
 *
 * Логин нормализуем так же, как при входе: иначе «Ivanov» и «ivanov» считались бы разными ключами.
 * Считается для любого логина — существующего и нет: поведение должно быть одинаковым.
 */
export function userThrottleKey(username: string): string {
  return `user:${username.trim().toLowerCase()}`;
}

export type { Executor };
