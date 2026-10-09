import type { FastifyInstance } from 'fastify';

import { buildApp } from '../../src/app';
import { normalizeIp } from '../../src/shared/actor';
import type { Database } from '../../src/shared/db/client';
import { createTestEnv } from '../helpers';

/** Сборка приложения на тестовой базе и типовые действия (вход, мастер). */

export interface TestApp {
  app: FastifyInstance;
  close(): Promise<void>;
}

export async function createTestApp(db: Database): Promise<TestApp> {
  const app = await buildApp({ env: createTestEnv(), db, version: 'test' });

  return {
    app,
    async close(): Promise<void> {
      await app.close();
    },
  };
}

/** Пароль администратора в тестах: не содержит логин и проходит политику. */
export const ADMIN_PASSWORD = 'kollegiya-2025-secret';

export const DEFAULT_SETUP_PAYLOAD = {
  institution: { title: 'Тестовый колледж', shortName: 'ТК', signature: 'Дневник колледжа' },
  academicYear: { title: '2025/2026', startsOn: '2025-09-01', endsOn: '2026-06-30' },
  period: {
    title: '1 семестр',
    kind: 'semester' as const,
    startsOn: '2025-09-01',
    endsOn: '2025-12-31',
  },
  admin: {
    username: 'admin',
    fullName: 'Администратор Системы',
    password: ADMIN_PASSWORD,
  },
};

export type SetupPayload = typeof DEFAULT_SETUP_PAYLOAD;

/** Проходит мастер настройки и возвращает cookie администратора. */
export async function completeSetup(
  app: FastifyInstance,
  payload: SetupPayload = DEFAULT_SETUP_PAYLOAD,
): Promise<{ cookie: string; userId: string }> {
  const response = await app.inject({ method: 'POST', url: '/api/setup/complete', payload });

  if (response.statusCode !== 201) {
    throw new Error(`Мастер настройки не прошёл: ${response.statusCode} ${response.body}`);
  }

  const cookie = cookieHeader(response.cookies);
  const body = response.json() as { session: { user: { id: string } } };

  return { cookie, userId: body.session.user.id };
}

export function cookieHeader(cookies: Array<{ name: string; value: string }>): string {
  const session = cookies.find((item) => item.name === 'edu_diary_session');
  if (session === undefined) throw new Error('Cookie сессии не установлена');
  return `${session.name}=${session.value}`;
}

export async function login(
  app: FastifyInstance,
  username: string,
  password: string,
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
  });

  if (response.statusCode !== 200) {
    throw new Error(`Вход не удался: ${response.statusCode} ${response.body}`);
  }

  return cookieHeader(response.cookies);
}

export interface CreatedUser {
  id: string;
  cookie: string;
}

/** Создаёт пользователя администратором и сразу входит под ним. */
export async function createUserAndLogin(
  app: FastifyInstance,
  adminCookie: string,
  input: {
    username: string;
    fullName: string;
    password: string;
    roles: string[];
  },
): Promise<CreatedUser> {
  const created = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: { cookie: adminCookie },
    payload: input,
  });

  if (created.statusCode !== 201) {
    throw new Error(`Пользователь не создан: ${created.statusCode} ${created.body}`);
  }

  const user = created.json() as { id: string };
  const cookie = await login(app, input.username, input.password);

  return { id: user.id, cookie };
}

export async function createStudent(
  app: FastifyInstance,
  adminCookie: string,
  input: { fullName: string; userId?: string | null },
): Promise<{ id: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/students',
    headers: { cookie: adminCookie },
    payload: input,
  });

  if (response.statusCode !== 201) {
    throw new Error(`Ученик не создан: ${response.statusCode} ${response.body}`);
  }

  return response.json() as { id: string };
}

export async function publishPolicy(app: FastifyInstance, adminCookie: string): Promise<void> {
  const response = await app.inject({
    method: 'PUT',
    url: '/api/privacy-policy',
    headers: { cookie: adminCookie },
    payload: {
      version: '1.0',
      text: 'Политика обработки персональных данных в тестовом колледже.',
    },
  });

  if (response.statusCode !== 200) {
    throw new Error(`Политика не опубликована: ${response.statusCode} ${response.body}`);
  }
}

export { normalizeIp };
