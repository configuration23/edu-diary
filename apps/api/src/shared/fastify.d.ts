import type { AuthContext } from './auth-context';

/**
 * Расширение запроса Fastify контекстом аутентификации.
 *
 * Тип объявлен в `shared`, чтобы модули не зависели от модуля `auth` ради
 * одного поля: сессию заполняет хук в `app.ts`.
 */
declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}
