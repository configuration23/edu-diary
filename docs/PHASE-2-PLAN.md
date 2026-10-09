# План Этапа 2 — учебный год, группы, ученики, справочники

Рабочий документ этапа. Источники: `ROADMAP.md` (Этап 2), `ARCHITECTURE.md` §4–6, §8, §10, `DECISIONS.md`.
Порядок работ общий: **тесты на домен и права → API и схема БД → интерфейс → сквозной сценарий**.

## 1. Что уже есть после Этапа 1

| Готово | Где |
|---|---|
| `academic_year`, `period`, `student` + CRUD годов/периодов/учеников | `apps/api/src/modules/academics` |
| Права `academics:read/write`, `students:read/write` и роли из коробки | `apps/api/src/modules/iam/iam.catalog.ts` |
| Аудит изменений и доступа (`audit.record` в транзакции изменения) | `apps/api/src/modules/audit` |
| Брендинг в `setting` (`branding.*`) и его вывод на входе и в шапке | `modules/settings`, `apps/web/src/App.tsx`, `components/AppLayout.tsx` |
| Тестовая обвязка API на реальной БД (`completeSetup`, `createUserAndLogin`, `createStudent`) | `apps/api/test/helpers/api.ts` |

В `academics.schema.ts` прямо помечено, что группы, предметы, аудитории и назначения добавляет Этап 2.

## 2. Чего не хватает для критериев приёмки

1. Админ не может создать год/период/группу/учеников/предметы/назначения **без разработчика** (нет API и экранов).
2. Нет проверки «учитель видит только свои назначения» — самих назначений нет.
3. Нет запрета удаления предмета с оценками — таблицы оценок ещё нет, но правило и ответ API должны появиться уже сейчас (FK `on delete restrict` + понятная ошибка).

## 3. Решения по модели (до кода)

### 3.1 Новые таблицы (миграция только вперёд)

```sql
study_group(id uuid pk, academic_year_id fk → academic_year on delete restrict,
            name text, course int null, specialty text null, curator_user_id uuid null,
            starts_on date, ends_on date, created_at, updated_at,
            unique (academic_year_id, name))

student_enrollment(id uuid pk, student_id fk → student on delete restrict,
                   study_group_id fk → study_group on delete restrict,
                   joined_on date, left_on date null, note text null,
                   index (study_group_id, left_on), index (student_id, left_on))

subject(id uuid pk, name text, short_name text null,
        kind text /* mandatory|optional|practice */, color text null)

room(id uuid pk, name text, capacity int null, note text null, unique (name))

grade_category(id uuid pk, code text unique, title text, weight int, color text null,
               is_default bool default false)

teaching_assignment(id uuid pk, teacher_user_id uuid /* без FK, как student.user_id: ADR-027 */,
                    subject_id fk → subject on delete restrict,
                    study_group_id fk → study_group on delete restrict,
                    starts_on date, ends_on date null, hours_planned int null,
                    created_at, updated_at,
                    index (teacher_user_id), index (study_group_id, subject_id))
```

Правила:

- `unique (academic_year_id, name)` у группы и `unique (name)` у аудитории — понятная ошибка вместо двух «A-101».
- Все внешние ключи справочников — `on delete restrict` (ARCHITECTURE.md §5): удаление предмета, по которому есть история, невозможно.
- Даты — тип `date` в строковом режиме (ADR-016).
- Ссылка на пользователя-преподавателя — без FK (цикл схем `iam` ↔ `academics`, ADR-027); существование и роль проверяет сервис через порт `users`.

### 3.2 Доменные правила (в `packages/domain`, покрываются тестами до API)

| Правило | Проверка |
|---|---|
| Дата начала не позже окончания | для года, периода, группы, назначения, зачисления |
| Период внутри своего учебного года | `period ∈ [year.startsOn, year.endsOn]` |
| Периоды одного года не перекрываются | по интервалам дат |
| Начало ≤ окончания у назначения и зачисления | как выше |
| Активный год ровно один | переключение в одной транзакции |

### 3.3 Удаление справочников: запрет с понятным сообщением

Решение: `on delete restrict` в БД **плюс** предварительная проверка в сервисе, чтобы вернуть осмысленный отказ, а не ошибку драйвера.

- `409 CONFLICT` с `details.reason` и `details.usedBy` (`grades` / `lessons` / `assignments` / `homework` / `enrollments`).
- Правило действует и сейчас, хотя оценки появятся на Этапе 3–4: запрос «есть ли зависимые записи» строится по таблицам, которые уже существуют, и расширяется миграцией, а не переписыванием API.

### 3.4 Назначения: закрытие периодом, а не удалением

У назначения есть `ends_on`, поэтому:

- «удалить» = закрыть период (`ends_on = <дата>`) с записью в аудите — история «кто вёл» сохраняется (архитектура §4.1);
- жёсткое удаление разрешено только для назначения без зависимых записей и фиксируется в аудите.

### 3.5 Модули и границы

- Группы, зачисления, предметы, аудитории, категории — модуль `academics` (он владеет учебным процессом и уже содержит годы/периоды/учеников).
- Назначения — новый модуль `staffing` (ARCHITECTURE.md §3), потому что на Этапе 3 к нему добавляются замены (`substitution`), и он же владеет вопросом «кто вправе вести эту группу».
- Зависимости `staffing`: `academics` (группы и предметы), `iam` (существование и активность преподавателя) и `audit`. Направления «staffing → academics» и «staffing → iam» ацикличны, а правило `module-boundary` разрешает импорт только через публичные входы (`../academics`, `../iam`), что проверяет `check:architecture`.
- Учитель уже имеет `academics:read@all` («справочники видит любой сотрудник»), а `academics:write@all` есть только у администратора: новых прав для справочников не требуется, назначения охраняются этой же парой.

## 4. Схема API (дополнение к ARCHITECTURE.md §10)

| Метод | Путь | Право | Назначение |
|---|---|---|---|
| GET | `/api/academic-years/:id/periods` | `academics:read@all` | периоды года |
| POST | `/api/academic-years/:id/activate` | `academics:write@all` | активный год ровно один |
| PATCH | `/api/periods/:id` | `academics:write@all` | правка периода |
| GET | `/api/groups?academicYearId=&search=` | `academics:read@all` | список групп |
| POST/PATCH/DELETE | `/api/groups`, `/api/groups/:id` | `academics:write@all` | группы |
| GET | `/api/groups/:id/students` | `students:read@assigned` | состав группы |
| POST | `/api/groups/:id/enrollments` | `students:write@all` | зачислить ученика |
| PATCH | `/api/enrollments/:id` | `students:write@all` | отчислить (дата) |
| POST | `/api/students/:id/transfer` | `students:write@all` | перевод: закрыть старое, открыть новое |
| GET/POST/PATCH/DELETE | `/api/subjects`, `/api/subjects/:id` | `academics:read/write` | предметы |
| GET/POST/PATCH/DELETE | `/api/rooms`, `/api/rooms/:id` | `academics:read/write` | аудитории |
| GET/POST/PATCH/DELETE | `/api/grade-categories`, `/api/grade-categories/:id` | `academics:read/write` | категории с весами |
| GET | `/api/assignments?teacherUserId=&groupId=&subjectId=` | `academics:read@all` | назначения |
| GET | `/api/assignments/mine` | `academics:read@assigned` | **только свои** (критерий этапа) |
| POST/PATCH | `/api/assignments`, `/api/assignments/:id` | `academics:write@all` | создать/закрыть период |
| POST | `/api/assignments/:id/close` | `academics:write@all` | закрыть без удаления |
| GET | `/api/settings/branding` | `academics:read@all` | текущий брендинг |
| PUT | `/api/settings/branding` | `settings:write@all` | правка брендинга (аудит) |

Ошибки: `VALIDATION_FAILED` (даты, границы), `NOT_FOUND`, `CONFLICT` (дубликат имени, удаление с историей, второй активный год).

## 5. Задачи по порядку

### Шаг 1. Домен и контракты (без БД)
- [ ] `packages/domain`: правила дат/перекрытий/границ года + тесты.
- [ ] `packages/contracts/academics.ts`: схемы групп, зачислений, предметов, аудиторий, категорий, назначений, брендинга + тесты схем.
- [ ] Права `iam.catalog.ts`: переиспользуем `academics:read/write` (учитель — только чтение); каталог меняется лишь если проверка покажет нехватку.

### Шаг 2. Схема БД и миграция
- [x] `academics.schema.ts`: `study_group`, `student_enrollment`, `subject`, `room`, `grade_category`.
- [x] `staffing.schema.ts`: `teaching_assignment` (плюс `note` — причина закрытия или правки).
- [x] Миграция `0003_academic_structure` (только вперёд) применена к тестовой и пустой базе; ограничения проверены вручную.
- Отличия от первоначального наброска: `subject.name` и `room.name` объявлены уникальными (защита от дублей), `teaching_assignment.note` добавлен для причины закрытия.

### Шаг 3. API academics (группы, зачисления, справочники)
- [ ] Репозиторий: SQL только здесь; листинги с фильтрами и подсчётом зависимостей.
- [ ] Сервис: проверки дат, дублей, удаления с историей; `audit.record` в той же транзакции; перевод ученика — одной транзакцией.
- [ ] Роуты + гварды прав; регистрация в `app.ts`.

### Шаг 4. API staffing (назначения)
- [ ] Порт `users` (существование и активность преподавателя) — через `iam`, без импорта чужих файлов.
- [ ] `GET /api/assignments/mine` для преподавателя; админ видит всё.
- [ ] Аудит создания, правки и закрытия назначения.

### Шаг 5. Брендинг
- [ ] `PUT /api/settings/branding` (право `settings:write`), запись в аудит.
- [ ] Проверка: шапка и экран входа обновляются после сохранения.

### Шаг 6. Тесты API (до интерфейса)
- [ ] Учитель видит только свои назначения (сессия учителя) и не может их менять.
- [ ] Удаление предмета/аудитории/группы с историей → `409` с понятным `details`.
- [ ] Зачисление и перевод: границы дат, отсутствие двух активных зачислений.
- [ ] Каждое изменение справочника → запись в аудите с `before`/`after`.
- [ ] Брендинг: право, сохранение, аудит.

### Шаг 7. Интерфейс
- [ ] Разделы: «Учебный год и периоды», «Группы и ученики», «Справочники», «Назначения», «Настройки».
- [ ] Переключатель активного года и группы в шапке (ARCHITECTURE.md §4.1: группа — контекст, а не отдельный экран).
- [ ] Навигация скрывает разделы без прав; отказ API показывается текстом из `details`.

### Шаг 8. Сквозной сценарий и сдача этапа
- [ ] Playwright: админ проходит путь «год + периоды → группа → 2 ученика → предметы и аудитории → назначение»; учитель входит и видит своё назначение, но не чужое.
- [ ] `npm run seed:demo` (обещан в `ROADMAP.md`): демо-данные только при `NODE_ENV` ≠ production, с явным отказом в проде.
- [ ] Обновить `docs/README.md` (состояние этапа) и `docs/ARCHITECTURE.md` §10; при расхождениях — новые ADR в `DECISIONS.md`.

## 6. Определение готовности (из `ROADMAP.md`, Этап 2)

1. Админ создаёт год, период, группу, учеников, предметы и назначения **без разработчика**.
2. Учитель видит только свои назначения (тест API с сессией учителя).
3. Удаление предмета, по которому есть оценки, запрещено с понятным сообщением.
4. Плюс общие правила проекта: `npm test` (включая интеграционные с `TEST_DATABASE_URL`), `npm run typecheck`, `npm run format:check`, `npm run check:architecture`, `npm run build`, зелёный CI.

## 7. Локальная специфика этой машины

- `.env` отличается от примера: `HTTP_PORT=8081`, `POSTGRES_PORT=15432`; база `edu_diary` уже инициализирована, поэтому локально виден экран входа, а не мастер.
- PostgreSQL поднимается `docker compose up -d postgres` (порт наружу отдан на 15432); в CI-прогонах переменные приходят из окружения.
- `npm test` без `TEST_DATABASE_URL` пропускает 41 интеграционный тест: vitest не читает `.env`, переменную нужно передать из окружения. Полный прогон (156 тестов + новые): `TEST_DATABASE_URL=postgres://edu_diary:<пароль>@localhost:15432/edu_diary_test npm test`.
- `npm run build`, `npm test`, `npm run db:generate`, `docker compose` в песочнице падают с `EPERM` (дочерние процессы Vite/esbuild и именованные каналы Docker) — лечится разовым расширением доступа на ту же команду.
- Сквозные сценарии Playwright ожидают пустую базу, поэтому для них есть отдельная команда:
  `npm run e2e:isolated` — создаёт (при необходимости) базу `edu_diary_e2e`, применяет к ней миграции и запускает
  Playwright, не затрагивая базу разработки. Проверено на этой машине: 10 сценариев зелёные.
  Флаги: `--keep` (не пересоздавать существующую базу), `--fresh` (пересоздать), имя базы — `E2E_DATABASE_NAME`.
