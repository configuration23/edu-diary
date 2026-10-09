# edu-diary

Электронный дневник колледжа: журнал, посещаемость, домашние задания, аналитика и связь с
родителями.

Проектная документация — в [docs/README.md](docs/README.md), порядок работ — в
[docs/ROADMAP.md](docs/ROADMAP.md).

**Текущее состояние: Этап 0 «Фундамент репозитория».** Приложения ещё не имеют учётных записей,
журнала и интерфейсов работы с данными — это Этапы 1–4. Здесь собран фундамент: монорепозиторий,
стек в Docker, миграции, health-check, тесты и проверки качества в CI.

## Что уже работает

- Монорепозиторий на npm workspaces: `apps/api`, `apps/web`, `packages/contracts`, `packages/domain`.
- `docker compose` поднимает `postgres`, `migrate`, `api`, `web`, `caddy`.
- Миграции Drizzle Kit и команда `npm run migrate` (отдельным шагом, не при старте API).
- Каркас Fastify: `/api/health` (процесс, БД, состояние миграций), единый формат ошибок,
  структурированные логи с `requestId`.
- Vitest и Playwright; тесты архитектуры, сборки и секретов.
- CI: проверки, тесты, сквозные сценарии и фактический запуск стека в `docker compose`.

## Требования

- Node.js 22 и npm 10 (см. `.nvmrc`).
- Docker с поддержкой Compose v2 — для запуска стека и для локальной базы.

## Быстрый старт: весь стек в Docker

```bash
npm run bootstrap:env    # создаёт .env со случайными секретами
docker compose up        # собирает образы и поднимает стек
```

- Приложение: <http://localhost:8080>
- Состояние системы: <http://localhost:8080/api/health>

Остановить: `docker compose down`. Удалить данные: `docker compose down -v`.

Если порт 8080 занят, задайте в `.env` другой `HTTP_PORT` — и тот же порт в `SITE_ADDRESS`.

`npm run bootstrap:env` обязателен: секретов в репозитории нет, и приложение намеренно не
стартует, если `DATABASE_URL`, `SESSION_SECRET` или `STORAGE_ENCRYPTION_KEY` не заданы или
равны примерам из `.env.example` ([docs/SECURITY.md](docs/SECURITY.md) §3.2).

## Разработка без контейнеров

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres   # база на 127.0.0.1:5432
npm install
npm run bootstrap:env
npm run migrate
npm run dev          # API на http://127.0.0.1:3000
npm run dev:web      # интерфейс на http://127.0.0.1:5173 (проксирует /api на API)
```

Если 5432 занят, задайте в `.env` другой `POSTGRES_PORT` и тот же порт в `DATABASE_URL`
и `TEST_DATABASE_URL`. Отдельная база `edu_diary_test` для интеграционных тестов создаётся
автоматически при первом запуске контейнера (`docker/postgres-dev-init.sql`).

## Команды

| Команда                           | Что делает                                         |
| --------------------------------- | -------------------------------------------------- |
| `npm run dev` / `npm run dev:web` | запуск API и фронтенда с горячей перезагрузкой     |
| `npm run build`                   | проверка архитектуры + сборка API и фронтенда      |
| `npm run typecheck`               | проверка типов во всех рабочих пространствах       |
| `npm run migrate`                 | применение миграций к базе из `DATABASE_URL`       |
| `npm run db:generate`             | генерация новой SQL-миграции из схем Drizzle       |
| `npm test` / `npm run test:watch` | тесты Vitest                                       |
| `npm run test:e2e`                | сквозные сценарии Playwright (нужны база и сборка) |
| `npm run check`                   | типы + архитектура + поиск секретов                |
| `npm run check:architecture`      | границы модулей (падает при запрещённом импорте)   |
| `npm run check:secrets`           | поиск секретов в репозитории                       |
| `npm run check:bundle-domains`    | внешние домены в собранном клиенте                 |
| `npm run check:startup-secrets`   | отказ старта без секретов (нужна сборка)           |
| `npm run format` / `format:check` | Prettier                                           |

## Структура

```
apps/api              Fastify: модульный монолит
  src/modules/*       модули (settings, health) со своим публичным входом index.ts
  src/shared/*        общая инфраструктура: env, логи, ошибки, БД, пути
  drizzle/            SQL-миграции и журнал Drizzle
  test/               тесты API
apps/web              React 19 + Vite + Tailwind
packages/contracts    Zod-схемы API, общие для сервера и клиента
packages/domain       чистая доменная логика (даты по ADR-016, далее — правила и расчёты)
tools/                проверки качества и вспомогательные скрипты
e2e/                  сквозные сценарии Playwright
docs/                 проектная документация (VISION, ARCHITECTURE, SECURITY, DECISIONS, ROADMAP)
```

## Что проверяется машиной, а не «помним и не делаем»

| Правило                                                    | Где проверка                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------- |
| Модуль обращается к другому модулю только через `index.ts` | `tools/quality/architecture.mjs`, `npm run check:architecture` |
| SQL — только в репозиториях и схемах модуля                | там же                                                         |
| Пакеты не зависят от приложений и друг от друга            | там же                                                         |
| В клиентском бандле нет внешних доменов                    | `npm run build` (шаг `check-bundle-domains`)                   |
| В репозитории нет секретов                                 | `npm run check:secrets`, CI                                    |
| Приложение не стартует без секретов и при значении-примере | `npm run check:startup-secrets`, `apps/api/test/env.test.ts`   |
| Версии зависимостей зафиксированы                          | `package-lock.json`, `npm ci` в CI                             |
| Критичные уязвимости зависимостей блокируют CI             | `npm audit --audit-level=high`                                 |

## Миграции

- Схемы Drizzle живут в модулях: `apps/api/src/modules/<модуль>/<имя>.schema.ts`.
- Новая миграция: изменить схему → `npm run db:generate` → проверить SQL в `apps/api/drizzle/`.
- Применение: `npm run migrate` (локально) или сервис `migrate` в compose. **Не** при старте API.
- Миграции только вперёд: откат делается новой миграцией ([docs/ROADMAP.md](docs/ROADMAP.md)).

## Переменные окружения

- Полный список с пояснениями — в [.env.example](.env.example).
- Обязательные секреты: `DATABASE_URL`, `SESSION_SECRET` (≥32 символа),
  `STORAGE_ENCRYPTION_KEY` (ровно 32 байта: base64 или 64 hex-символа).
- Файл `.env` подхватывается только при `NODE_ENV=development`. В production и test переменные
  задаёт окружение (docker compose, systemd, CI) — так «пустой» секрет не подставится из файла.
- Всё прикладное (брендинг, параметры правил) хранится в БД, а не в переменных окружения.

## Тесты

- `npm test` проходит на машине без базы: интеграционные тесты пропускаются без `TEST_DATABASE_URL`.
- С базой: `TEST_DATABASE_URL=... npm test` — тесты применят миграции и проверят `/api/health`.
- Сквозные: `npm run build && npm run migrate && npm run test:e2e` (Playwright поднимет API и
  предпросмотр фронтенда сам).

## Развёртывание

- Тестовый стенд и прод: `npm run bootstrap:env`, затем
  `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d` с `SITE_ADDRESS=домен`
  — Caddy сам получит сертификат Let's Encrypt.
- Локально и на закрытом стенде стек отдаётся по HTTP на порту 8080 без сертификата.
- PostgreSQL наружу не публикуется; для разработки порт открывается только на `127.0.0.1`
  через `docker-compose.dev.yml`.
