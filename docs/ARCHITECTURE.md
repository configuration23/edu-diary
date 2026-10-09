# ARCHITECTURE — `edu-diary`

Документ описывает целевую архитектуру нового приложения. Решения зафиксированы как ADR в `DECISIONS.md`.

---

## 1. Главные принципы

1. **Сервер — единственный источник правды.** Данные живут в PostgreSQL. Клиент ничего не хранит как хранилище: только состояние интерфейса (открытые панели, выбранная группа). Никаких «режимов хранения» и переключателей источника.
2. **Инварианты приватности — в коде, не в настройках.** Фильтрация по роли и области действия применяется на уровне запросов к БД и не отключается через интерфейс.
3. **Журнал — это урок.** Главная сущность предметной области — `lesson`. Оценки и посещаемость — его атрибуты, а не самостоятельные записи.
4. **Модульный монолит.** Один деплой, но модули изолированы: запрещены прямые импорты «модуль в модуль» минуя сервисный слой. Границы проверяются тестом.
5. **Всё изменяемое — в БД.** Включая брендинг, подпись на входе, параметры правил оценивания и настройки хранилища файлов.
6. **Аудит с первого дня.** Любое изменение значимых сущностей пишет запись: кто, когда, что было, что стало.

---

## 2. Стек и обоснование

| Слой | Выбор | Почему |
|---|---|---|
| БД | **PostgreSQL 16** | конкурентные транзакции, `jsonb`, партиционирование, `pg_dump`; SQLite был источником половины проблем |
| Миграции | **Drizzle Kit** | версионированные SQL-миграции, типобезопасная схема, генерация типов |
| Бэкенд | **TypeScript + Fastify** | Zod-схемы запросов/ответов, высокая скорость, простой плагинный слой |
| Валидация | **Zod** | одна схема на сервер и клиент, из неё же типы |
| Сессии | **httpOnly cookie + серверные сессии** | сессию можно отозвать, токен не читается скриптом; для внутренней системы проще, чем JWT |
| Хеш пароля | **argon2id** | современный стандарт; bcrypt — запасной вариант |
| Фронтенд | **React 19 + TypeScript + Vite** | знакомый стек, минимум риска |
| Данные на клиенте | **TanStack Query** | кеш, инвалидация, состояния загрузки/ошибки — лечит главную боль первой версии |
| Формы | **React Hook Form + Zod** | валидация одна на клиенте и сервере |
| Роутинг | **TanStack Router** | типизированные маршруты |
| UI | **Tailwind CSS + небольшой набор своих примитивов** | без тяжёлого UI-кита: Modal, Button, Field, Table, Toast, Confirm, EmptyState |
| Тесты | **Vitest** (домен и права) + **Playwright** (сквозные сценарии) | закрывают то, что в первой версии проверялось кликами |
| Деплой | **Docker Compose: postgres + api + web + Caddy** | Caddy сам получает HTTPS, меньше ручной работы |
| Бэкапы | **pg_dump по расписанию + проверка восстановления** | данные детей нельзя терять |

---

## 3. Модули и границы

```
apps/
  api/                     # Fastify, модули ниже
    src/modules/
      setup/               # мастер первого запуска
      auth/                # вход, сессии, смена пароля
      audit/               # журнал изменений (пишут все модули через сервис)
      iam/                 # пользователи, роли, права, привязки родитель↔ученик
      academics/           # учебные годы, периоды, группы, ученики, предметы, аудитории
      staffing/            # назначения преподавателей и замены
      schedule/            # шаблон расписания и отклонения
      journal/             # уроки, оценки, правила «плюсов/точек»
      attendance/          # посещаемость и причины
      homework/            # задания, решения, проверка, вложения
      analytics/           # средний балл, отчёты, выгрузки
      settings/            # брендинг, параметры системы, хранилище файлов
      storage/             # абстракция файлового хранилища (адаптеры)
  web/                     # React-приложение
packages/
  contracts/               # Zod-схемы и типы API, общие для api и web
  domain/                  # чистая доменная логика (эскалация, средний балл, права)
```

Правила изоляции:

- Модуль может импортировать **только** `packages/*` и собственные файлы. Обращение к другому модулю — через его сервисный интерфейс (экспортируется из `index.ts` модуля).
- SQL живёт только в `repositories` модуля. В роутах и сервисах SQL нет.
- Всё, что меняет данные, проходит через `auditService.record(...)`.
- Границы проверяются тестом `architecture.test.ts`: он падает при запрещённом импорте.

---

## 4. Домен: сущности и связи

```
academic_year ──< period
academic_year ──< group ──< student_enrollment >── student
group ──< teaching_assignment >── subject
                     │
                     ├──< lesson ──< attendance
                     │        └───< grade_entry ──< grade_revision
                     │        └─── grade_rule_application   (сработавшая эскалация)
                     └──< substitution (замена преподавателя на урок или период)

homework ──< homework_submission ──< attachment
user ──< user_role >── role ──< role_permission >── permission
student ──< guardian_link >── user            (родитель ↔ ученик)
consent                                       (согласие законного представителя)
audit_log                                     (кто, что, когда, было/стало)
security_event                                (события безопасности и инциденты)
setting                                       (ключ → jsonb)
```

### 4.1 Ключевые решения по модели

**Несколько групп (`group`) — закладываем сразу.** Это не усложнение: `group` уже есть как сущность, а расписание, назначения, ученики и уроки привязаны к ней. Разные группы получают разные расписания естественным образом.

- Учитель может вести один предмет в нескольких группах → `teaching_assignment` допускает несколько записей.
- Оценки, посещаемость и ДЗ **всегда** привязаны к группе через урок или назначение — смешивания между группами не бывает.
- Текущие потребности (2–5 групп) не требуют дополнительных сущностей; при росте до десятков групп добавляются только индексы и фильтры, схема не меняется.
- В интерфейсе группа — это переключатель контекста в шапке, а не отдельный экран.

**Учебные периоды (`period`) — обязательны с самого начала.** Без них любая аналитика по четвертям/семестрам делается костылями, а оценки «за год» невозможно посчитать корректно.

**Урок (`lesson`) — центральная сущность.** Атрибуты: дата, номер пары, время, группа, предмет, преподаватель, аудитория, тип занятия, статус (проведён / отменён / заменён).

- Посещаемость и оценки ссылаются на урок, а не на «дату + предмет». Это убирает целый класс ошибок: невозможно поставить оценку за урок, который не проводился, и нельзя случайно перезаписать отметку соседней пары.
- Замена — отдельная запись `substitution`, ссылающаяся на урок или на диапазон дат назначения. История «кто вёл» сохраняется.

**Эскалация «плюсы/точки → оценка».** Правило (`grade_rule`) привязано к предмету (опционально — к периоду) и содержит: тип знака (`plus`/`dot`), порог, результирующую оценку, категорию.

- Расчёт только на сервере.
- Идемпотентность: применённая эскалация фиксируется в `grade_rule_application` (ссылка на сработавшее правило, ученика, предмет, период, счётчик). Повторный пересчёт не создаёт вторую награду.
- Ручное удаление награды не «возвращает» счётчик — это отдельное действие, отражённое в аудите.

**Идентификаторы — UUID v7.** Сортируемые по времени создания и неугадываемые (в первой версии ID вида `s-1`, `g-1` позволяли перебирать чужие данные).

**Даты.** `date` для календарных полей (день урока, срок ДЗ) — без времени и без часовых поясов. `timestamptz` — только для аудита и служебных отметок.

---

## 5. Схема БД (основные таблицы)

> Полные DDL генерируются из схемы Drizzle; ниже — суть и важные ограничения.

```sql
-- Справочники
academic_year(id uuid pk, title text, starts_on date, ends_on date, is_active bool)
period(id uuid pk, academic_year_id fk, title text, kind text /* term|semester|quarter */,
       starts_on date, ends_on date, sort int)

subject(id uuid pk, name text, short_name text, kind text /* mandatory|optional|practice */, color text)
room(id uuid pk, name text, capacity int, note text)
study_group(id uuid pk, academic_year_id fk, name text, course int, specialty text, curator_user_id fk,
            starts_on date, ends_on date)

-- Люди
app_user(id uuid pk, username citext unique, password_hash text, full_name text,
         email citext, phone text, is_active bool, must_change_password bool,
         failed_login_count int, locked_until timestamptz,
         created_at timestamptz, updated_at timestamptz)
student(id uuid pk, full_name text, short_name text, birth_date date, note text)
student_enrollment(id uuid pk, student_id fk, study_group_id fk, joined_on date, left_on date)
guardian_link(id uuid pk, student_id fk, guardian_user_id fk, relation text /* mother|father|other */)
role(id uuid pk, code text unique, title text, is_system bool)
permission(code text pk, title text)                      -- grades:write, homework:review, ...
role_permission(role_id fk, permission_code fk, scope text) -- own|assigned|group|all
user_role(user_id fk, role_id fk)

-- Учебный процесс
teaching_assignment(id uuid pk, teacher_user_id fk, subject_id fk, study_group_id fk,
                    starts_on date, ends_on date, hours_planned int)
substitution(id uuid pk, assignment_id fk, substitute_user_id fk, lesson_id fk null,
             starts_on date, ends_on date, reason text, created_by fk)

lesson(id uuid pk, assignment_id fk, study_group_id fk, teacher_user_id fk, room_id fk null,
       lesson_date date, pair_number int, time_start time, time_end time, topic text,
       lesson_type text, status text /* planned|done|cancelled|replaced */,
       unique (study_group_id, lesson_date, pair_number))
grade_entry(id uuid pk, lesson_id fk, student_id fk, value_kind text /* number|plus|dot */,
            value_num int null, category_id fk, comment text,
            created_by fk, created_at timestamptz, deleted_at timestamptz null)
grade_revision(id uuid pk, grade_entry_id fk, changed_by fk, changed_at timestamptz,
               before jsonb, after jsonb, reason text)
grade_category(id uuid pk, code text, title text, weight int, color text, is_default bool)
grade_rule(id uuid pk, subject_id fk null, mark_kind text, threshold int, result_grade int,
           category_id fk, period_id fk null, is_active bool)
grade_rule_application(id uuid pk, rule_id fk, student_id fk, subject_id fk, period_id fk null,
                       counter_value int, awarded_grade_id fk, applied_at timestamptz,
                       unique (rule_id, student_id, subject_id, counter_value))
attendance(id uuid pk, lesson_id fk, student_id fk,
           status text /* present|late|excused|sick|absent */, reason text, noted_by fk)
schedule_entry(id uuid pk, study_group_id fk, day_of_week int, pair_number int,
               time_start time, time_end time, subject_id fk, teacher_user_id fk, room_id fk,
               valid_from date, valid_to date null)
schedule_exception(id uuid pk, study_group_id fk, exception_date date, pair_number int,
                   action text /* cancel|move|replace */, payload jsonb)

-- Домашние задания
homework(id uuid pk, assignment_id fk, study_group_id fk, subject_id fk, title text, description text,
         assigned_on date, due_on date, created_by fk, created_at timestamptz)
homework_submission(id uuid pk, homework_id fk, student_id fk, text_solution text,
                    submitted_at timestamptz, status text /* draft|submitted|reviewed|needs_work */,
                    reviewed_by fk null, reviewed_at timestamptz, feedback text, grade_entry_id fk null)
attachment(id uuid pk, owner_kind text /* homework|submission|branding */, owner_id uuid,
           kind text /* link|file */, title text, url text null, storage_key text null,
           mime_type text, size_bytes bigint, uploaded_by fk, created_at timestamptz)

-- Системное
setting(key text pk, value jsonb, updated_by fk, updated_at timestamptz)

-- Согласия на обработку ПДн (см. SECURITY.md §3.5)
consent(id uuid pk, subject_student_id fk null, subject_user_id fk null,
        guardian_user_id fk null, policy_version text, granted_at timestamptz,
        granted_via text /* paper|electronic */, document_ref text,
        revoked_at timestamptz null, revoked_reason text)

-- События безопасности и инциденты (см. SECURITY.md §3.7)
security_event(id uuid pk, kind text, severity text /* info|warning|critical */,
               actor_user_id fk null, ip inet null, details jsonb,
               detected_at timestamptz, acknowledged_by fk null,
               acknowledged_at timestamptz null, resolution text null)

audit_log(id uuid pk, actor_user_id fk null, actor_ip inet, action text, entity_kind text,
          entity_id uuid null, before jsonb, after jsonb, context jsonb, created_at timestamptz)
session(id uuid pk, user_id fk, token_hash text unique, expires_at timestamptz,
        user_agent text, ip inet, created_at timestamptz)
```

Важные ограничения:

- `unique (study_group_id, lesson_date, pair_number)` — в одной группе не может быть двух уроков на одной паре.
- `grade_entry` — мягкое удаление (`deleted_at`), чтобы аудит и восстановление работали.
- Все внешние ключи — с `on delete restrict` для справочников: удаление предмета, по которому есть оценки, запрещено (в первой версии предмет удалялся и оценки «висели» в пустоте).
- Индексы: `grade_entry (student_id, lesson_id)`, `lesson (study_group_id, lesson_date)`, `attendance (student_id)`, `audit_log (created_at desc)`, `audit_log (entity_kind, entity_id)`, `security_event (detected_at desc)`, `consent (subject_student_id)`.
- Медицинские сведения и государственные идентификаторы (СНИЛС, ИНН, полис) в схеме **отсутствуют намеренно** — см. `SECURITY.md` §2.
- Записи `audit_log`, `security_event` и `consent` не изменяются и не удаляются через API; истории `grade_revision` и `audit_log` хранятся отдельно от изменяемых данных.

---

## 6. Транзакционные инварианты (проверяются сервером)

| Инвариант | Где обеспечивается |
|---|---|
| Ученик/родитель получают только свои данные | фильтр в репозиториях по `student_id` из сессии + тесты |
| Учитель ставит оценки только по своим назначениям | проверка `teaching_assignment` в сервисе + фильтр |
| Нельзя поставить оценку за отменённый урок | проверка статуса урока |
| Удаление справочника с историей запрещено | `on delete restrict` + понятная ошибка в UI |
| Правило эскалации не срабатывает дважды за один счётчик | `unique` в `grade_rule_application` |
| Любая правка значимой сущности попадает в аудит | общий сервис `audit.record()` в транзакции изменения |
| Полная замена коллекции (расписание) не теряет чужие правки | только точечные операции, никаких `DELETE` + `INSERT` всего списка |

---

## 7. Файлы и вложения

Требование: учитель прикрепляет материалы (ссылка, текст, картинка, файл), ученик — решение. Файлы не должны раздувать контейнер, место хранения должно настраиваться.

**Абстракция `storage`:**

```ts
interface StorageAdapter {
  put(key: string, data: Buffer, mime: string): Promise<{ key: string; url?: string }>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  publicUrl?(key: string): string;
}
```

Адаптеры:

| Адаптер | Когда использовать | Настройка |
|---|---|---|
| `local` (по умолчанию) | небольшой сервер | каталог вне контейнера, монтируется томом |
| `s3` | внешнее хранилище | endpoint, bucket, ключи, region |
| `webdav` | если у колледжа уже есть файловый сервер | URL, логин, пароль |

Правила:

- В БД хранится только `storage_key` и метаданные; файлы — в выбранном хранилище.
- **Размещение — только на территории РФ** (ч. 5 ст. 18 152-ФЗ): локальный каталог на сервере в РФ, либо собственный MinIO, либо российский провайдер. Публичные иностранные объектные хранилища запрещены. Бэкапы подчиняются тому же правилу.
- Параметры хранилища — в `setting` (`storage.provider`, `storage.local.path`, ключи S3) и задаются в мастере настройки или в админке. Ключи S3 шифруются симметрично ключом из переменных окружения.
- Ограничения: максимальный размер (настраивается, по умолчанию 10 МБ на файл), белый список MIME и расширений, проверка содержимого (не доверяем заголовку от клиента), имена объектов — случайные UUID (никаких путей от пользователя).
- Отдача файлов — через API с проверкой прав, а не прямой ссылкой на файловую систему: иначе по угадываемому URL утекут работы других учеников.
- Антивирусная проверка — вне рамок, но точка расширения предусмотрена (хук `beforeStore`).

---

## 8. Роли, права, сессии

**Права:** строки `resource:action` (`grades:write`, `grades:read`, `homework:review`, `users:manage`, `settings:write`, `audit:read`, …).

**Область действия (scope):** `own` | `assigned` | `group` | `all`. Одно и то же право с разным scope даёт разные возможности: `grades:read@assigned` — учитель видит свои предметы, `grades:read@all` — админ видит всё.

**Роли из коробки:** `admin`, `teacher`, `student`, `parent`. Админ может создавать роли и менять наборы прав и scope.

**Что нельзя изменить настройками (жёсткие инварианты):**

- ученик и родитель никогда не получают данные чужих учеников;
- учитель не видит и не меняет чужие назначения, если ему явно не выдан scope шире;
- записи аудита нельзя удалить или изменить через API.

**Аутентификация:**

- Пароль — `argon2id`. Минимальные требования к длине, проверка на утечки (по возможности), смена при первом входе для учёток, созданных админом.
- Сессия — случайный токен, в БД хранится только его хеш; cookie `httpOnly`, `Secure`, `SameSite=Lax`, срок жизни 8 часов с продлением при активности.
- Защита от перебора: счётчик неудач и временная блокировка (`failed_login_count`, `locked_until`).
- Сброс пароля — администратором (для внутренней системы достаточно) плюс смена своего пароля.
- Никаких демо-учёток в коде. Первый админ создаётся мастером настройки.

---

## 9. Мастер первого запуска

1. Приложение стартует в состоянии «не настроено»: все API, кроме `/api/setup/*`, отвечают `503` с кодом `SETUP_REQUIRED`.
2. `GET /api/setup/status` — что уже настроено.
3. Шаги мастера: подключение к БД (проверка соединения, версии, прав, применение миграций) → учебное заведение (название, логотип, подпись) → учебный год и первый период → администратор (логин, пароль, email) → хранилище файлов (по умолчанию локальное) → сводка и завершение.
4. После завершения пишется `setting: system.initialized = true`, мастер закрывается навсегда.
5. Альтернатива для серверов без браузера: `npm run setup -- --db-url=... --admin-username=... --admin-password=...` (пароль читается из stdin или переменной, не из аргументов командной строки).

---

## 10. API: контракт (первые эндпоинты)

Все ответы — JSON, ошибки — единый формат `{ error: { code, message, details? } }`. Схемы в `packages/contracts`, из них генерируются типы для клиента.

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/setup/status` | состояние первичной настройки |
| POST | `/api/setup/complete` | завершить настройку |
| POST | `/api/auth/login` | вход, ставит cookie-сессию |
| POST | `/api/auth/logout` | выход, отзыв сессии |
| GET | `/api/auth/me` | текущий пользователь, роли, права |
| POST | `/api/auth/change-password` | смена своего пароля |
| GET | `/api/users` | список пользователей (право `users:read`) |
| POST | `/api/users` | создать пользователя |
| PATCH | `/api/users/:id` | изменить, деактивировать |
| POST | `/api/users/:id/roles` | назначить роли |
| GET/POST | `/api/roles`, `/api/roles/:id/permissions` | роли и их права |
| GET/POST | `/api/students`, `/api/students/:id` | ученики |
| POST | `/api/students/:id/guardians` | привязать родителя |
| GET/POST | `/api/groups`, `/api/groups/:id/enrollments` | группы и зачисления |
| GET/POST | `/api/subjects`, `/api/rooms`, `/api/periods` | справочники |
| GET/POST | `/api/assignments` | назначения «учитель–предмет–группа» |
| POST | `/api/assignments/:id/substitutions` | замена преподавателя |
| GET | `/api/schedule?groupId=&from=&to=` | расписание с учётом исключений |
| POST | `/api/schedule/entries`, `/api/schedule/exceptions` | изменения расписания |
| POST | `/api/lessons/generate` | сгенерировать уроки из расписания на период |
| GET | `/api/lessons?groupId=&date=` | уроки дня |
| PATCH | `/api/lessons/:id` | тема, статус, замена, аудитория |
| PUT | `/api/lessons/:id/attendance` | отметки посещаемости за урок |
| POST | `/api/lessons/:id/grades` | поставить оценку/плюс/точку |
| PATCH/DELETE | `/api/grades/:id` | правка и мягкое удаление (с причиной) |
| GET/POST | `/api/homework` | задания |
| POST | `/api/homework/:id/submissions` | сдача решения |
| PATCH | `/api/submissions/:id` | проверка, отзыв, оценка |
| POST | `/api/attachments` | загрузка файла или ссылки |
| GET | `/api/attachments/:id/content` | выдача файла с проверкой прав |
| GET | `/api/analytics/average?...` | средний балл |
| GET | `/api/analytics/attendance?...` | посещаемость |
| GET | `/api/analytics/export.csv?...` | выгрузка |
| GET | `/api/audit?entityKind=&entityId=&actorId=` | журнал изменений и доступа |
| GET | `/api/security/events?severity=` | события безопасности и инциденты |
| POST | `/api/security/events/:id/ack` | отметить событие разобранным |
| GET/POST | `/api/consents` | согласия: список, регистрация, отзыв |
| GET/PUT | `/api/privacy-policy` | редакции политики обработки ПДн |
| POST | `/api/retention/purge` | регламентное уничтожение/обезличивание (только админ, с отчётом) |
| GET/PUT | `/api/settings` | настройки и брендинг |

---

## 11. Секреты, шифрование и соответствие требованиям ПДн

Кратко здесь, подробно — в `SECURITY.md`.

- **Секреты** только в переменных окружения: `DATABASE_URL`, `SESSION_SECRET`, `STORAGE_ENCRYPTION_KEY`. Приложение падает при старте, если секрет отсутствует или равен значению-примеру из `.env.example`. В репозитории секретов нет; в `docker-compose.yml` нет значений по умолчанию для них.
- **Ключи внешнего хранилища** (S3/WebDAV) хранятся в БД зашифрованными `STORAGE_ENCRYPTION_KEY`; в аудит и логи значения не попадают.
- **Канал** — только HTTPS (Caddy, автоматический сертификат, HSTS). HTTP редиректится.
- **Бэкапы** содержат персональные данные, поэтому: шифрование (`age`/`gpg`) ключом вне сервера, хранение на территории РФ, ограниченный доступ, проверка восстановления по регламенту (Этап 6).
- **Аудит доступа, а не только изменений**: просмотр журнала, карточки ученика, выгрузки и печать фиксируются (ADR-017). Записи аудита, согласий и событий безопасности недоступны для правки через API.
- **Согласия и политика** — в БД: редакции политики с версией, таблица `consent` для законных представителей (`SECURITY.md` §3.5).
- **Сроки хранения**: команда `retention:purge` уничтожает или обезличивает данные по истечении срока и пишет отчёт в аудит (`SECURITY.md` §3.6). Учётные записи сотрудников деактивируются, а не удаляются — история действий сохраняется.
- **Запрет внешних сервисов**: никаких CDN, шрифтов из интернета, аналитики и трекеров. Проверяется автоматическим тестом сборки — если в клиентском бандле есть внешний домен, сборка падает (`SECURITY.md` §3.8).
- **Обнаружение инцидентов**: таблица `security_event` и правила (всплеск неудачных входов, массовая выгрузка, изменение прав); страница «Безопасность» в админке; процедура реагирования — `SECURITY.md` §7.

---

## 12. Деплой, эксплуатация, бэкапы

```
docker compose:
  postgres   (том pgdata, не публикуется наружу)
  api        (Fastify, миграции при старте отдельной командой)
  web        (статика React)
  caddy      (HTTPS, прокси на api и web)
```

- Миграции применяются явной командой `npm run migrate` перед запуском API (не «на старте приложения»), чтобы контролировать момент.
- Бэкап: `pg_dump -Fc` по cron, хранение 30 дней, плюс `pg_restore` в отдельную БД раз в месяц для проверки.
- Логи: структурированные (JSON), с идентификатором запроса; ротация на уровне Docker (`max-size`, `max-file`).
- Метрики/здоровье: `/api/health` (процесс + БД + миграции), `/api/ready`.
- Переменные окружения — только инфраструктурные (`DATABASE_URL`, `SESSION_SECRET`, `STORAGE_ENCRYPTION_KEY`). Всё прикладное — в БД.

---

## 13. Что проверяется тестами с первого дня

1. **Домен (`packages/domain`):** эскалация плюсов/точек (включая идемпотентность), расчёт среднего балла с весами, процент посещаемости, определение текущего периода по дате.
2. **Права:** ученик не видит чужого, родитель — только своих детей, учитель — только свои назначения; админ видит всё. Тесты на уровне API с разными сессиями.
3. **Аудит:** каждое изменение значимой сущности создаёт запись с before/after; просмотр журнала, карточки ученика, выгрузка и печать создают запись доступа.
4. **Сквозные (Playwright):** вход → урок → оценка → ученик видит свою оценку, но не чужую → родитель видит ребёнка.
5. **Архитектура:** запрещённые импорты между модулями ломают сборку.
6. **Безопасность (`SECURITY.md` §5):** недоступность чужих данных ни одним способом, невозможность правки аудита и согласий через API, падение сборки при внешнем домене в бандле, отказ старта без обязательных секретов.
