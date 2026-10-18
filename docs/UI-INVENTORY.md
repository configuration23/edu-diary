# Замеры интерфейса

Отчёт **генерируется**: `npm run ui:inventory`. Руками не правится — правки затрутся при
следующем запуске, а числа разойдутся с кодом.

Файлов `.tsx`: **42** (экранов: 24), строк: 13340.

## Примитивы: что уже есть

| Объект | Использований | Файлов |
| --- | --- | --- |
| Button | 171 | 27 |
| Field | 200 | 27 |
| Card | 59 | 24 |
| Section | 6 | 4 |
| Spoiler | 13 | 3 |
| Badge | 44 | 18 |
| Alert | 119 | 25 |
| Table | 21 | 13 |
| EmptyState | 38 | 20 |
| Toolbar | 1 | 1 |
| QueryState | 2 | 2 |
| PersonList | 1 | 1 |

## Дыра первая: контролы формы без примитива

| Элемент | Штук | Файлов |
| --- | --- | --- |
| <select> | 0 | 0 |
| <textarea> | 0 | 0 |
| input[type=checkbox] | 0 | 0 |
| input[type=file] | 0 | 0 |
| <input> без type | 0 | 0 |

Сырых контролов всего: **0**. Рамка поля ввода `rounded-md border border-slate-300` скопирована руками
**0** раз в 0 файлах — это один и тот же класс, повторённый
по месту.

## Дыра вторая: отступы без правила

| Отступ между блоками | Раз |
| --- | --- |
| flex flex-col gap-3 | 47 |
| flex flex-col gap-1 | 29 |
| flex flex-col gap-6 | 13 |

| Внутренний отступ | Раз |
| --- | --- |
| p-4 | 23 |
| p-3 | 16 |
| p-6 | 7 |
| p-2 | 2 |
| p-5 | 1 |

| Высота контрола | Раз |
| --- | --- |
| py-2 | 159 |
| py-1 | 22 |
| py-0.5 | 5 |
| py-3 | 2 |

| Радиус | Раз |
| --- | --- |
| rounded-md | 91 |
| rounded | 20 |
| rounded-lg | 7 |
| rounded-sm | 1 |

| Сетка формы | Раз |
| --- | --- |
| sm:grid-cols-2 | 15 |
| sm:grid-cols-4 | 8 |
| sm:grid-cols-3 | 7 |

## Дыра третья: ссылки четырьмя способами

| Способ | Раз |
| --- | --- |
| text-blue-700 underline | 0 |
| cursor-pointer text-blue-700 | 0 |
| activeProps (навигация) | 2 |
| <Link | 4 |

## Акценты: сколько «главных» цветов

| Токен | Раз | Файлов |
| --- | --- | --- |
| bg-slate-900 | 1 | 1 |

Семейства цветов:

| Семейство | Раз |
| --- | --- |
| slate | 1 |

## Заголовки и ширины страниц

| Уровень | Раз |
| --- | --- |
| h2 | 5 |
| h3 | 4 |
| h1 | 3 |

| Ширина страницы | Раз |
| --- | --- |
| form | 1 |

## Размещение создания

Создание по кнопке в шапке списка (файлов: 7):

- `apps/web/src/screens/AcademicsScreen.tsx`
- `apps/web/src/screens/AssignmentsScreen.tsx`
- `apps/web/src/screens/CatalogsScreen.tsx`
- `apps/web/src/screens/GroupsScreen.tsx`
- `apps/web/src/screens/ScheduleTemplateScreen.tsx`
- `apps/web/src/screens/StudentsCard.tsx`
- `apps/web/src/screens/SubstitutionsScreen.tsx`

Отдельной постоянной карточкой (файлов: 5):

- `apps/web/src/screens/AcademicsScreen.tsx`
- `apps/web/src/screens/AssignmentsScreen.tsx`
- `apps/web/src/screens/GroupsScreen.tsx`
- `apps/web/src/screens/StudentsCard.tsx`
- `apps/web/src/screens/UsersScreen.tsx`

Вложенное создание внутри объекта:

- «Добавить период» — apps/web/src/screens/AcademicsScreen.tsx
- «Зачислить» — apps/web/src/screens/GroupsScreen.tsx
- «Привязать» — apps/web/src/screens/StudentsCard.tsx
- «Добавить в расписание» — apps/web/src/screens/ScheduleTemplateScreen.tsx

## Вложенность элементов

Замер идёт **по файлу**: если спойлер на странице содержит экран, а тот рисует карточку, лишний
уровень собирается из двух файлов и здесь не виден. Поэтому реальная вложенность на собранных
страницах **выше** этих чисел, а не равна им.

Максимальная глубина: **13**. Средняя: **3.9**.
Элементов глубже пятого уровня: **298**.

| Уровень | Элементов |
| --- | --- |
| 1 | 134 |
| 2 | 294 |
| 3 | 414 |
| 4 | 412 |
| 5 | 366 |
| 6 | 164 |
| 7 | 55 |
| 8 | 19 |
| 9 | 19 |
| 10 | 22 |
| 11 | 14 |
| 12 | 4 |
| 13 | 1 |

Блоки и их вложенность друг в друга (сколько блоков внутри блока — сверху худшие):

| Блок | Штук | Средняя глубина | Максимум блоков внутри блока |
| --- | --- | --- | --- |
| Section | 6 | 1.8 | 1 |
| Card | 59 | 1.5 | 1 |
| PageHeader | 4 | 2 | 1 |
| Spoiler | 13 | 2 | 1 |
| Page | 4 | 1 | 0 |

Самые глубокие файлы:

| Файл | Глубина |
| --- | --- |
| `screens/LessonJournalScreen.tsx` | 13 |
| `screens/ScheduleScreen.tsx` | 11 |
| `screens/LessonsScreen.tsx` | 10 |
| `components/ui.tsx` | 9 |
| `components/Spoiler.tsx` | 8 |
| `screens/AuditScreen.tsx` | 8 |
| `screens/ScheduleTemplateScreen.tsx` | 8 |
| `screens/AcademicsScreen.tsx` | 7 |
| `screens/CatalogsScreen.tsx` | 7 |
| `screens/GroupsScreen.tsx` | 7 |

## Экраны: где расхождений больше

Отсортировано по сумме «сырые контролы + скопированная рамка».

| Экран | Сырых контролов | Рамка | Card | Section | Заголовков |
| --- | --- | --- | --- | --- | --- |
| `AcademicProcessScreen.tsx` | 0 | 0 | 0 | 0 | 0 |
| `AcademicsScreen.tsx` | 0 | 0 | 3 | 0 | 0 |
| `AssignmentsScreen.tsx` | 0 | 0 | 2 | 0 | 0 |
| `AuditScreen.tsx` | 0 | 0 | 1 | 0 | 0 |
| `CatalogsScreen.tsx` | 0 | 0 | 5 | 0 | 0 |
| `DashboardScreen.tsx` | 0 | 0 | 2 | 0 | 0 |
| `GradesAttendanceScreen.tsx` | 0 | 0 | 10 | 0 | 3 |
| `GroupsScreen.tsx` | 0 | 0 | 3 | 0 | 0 |
| `LessonJournalScreen.tsx` | 0 | 0 | 5 | 0 | 0 |
| `LessonsScreen.tsx` | 0 | 0 | 1 | 0 | 0 |
| `LoginScreen.tsx` | 0 | 0 | 1 | 0 | 1 |
| `MyHomeworkScreen.tsx` | 0 | 0 | 4 | 0 | 0 |
| `NewGuardianCard.tsx` | 0 | 0 | 0 | 0 | 0 |
| `PrivacyScreen.tsx` | 0 | 0 | 4 | 0 | 0 |
| `ProfileScreen.tsx` | 0 | 0 | 0 | 3 | 0 |
| `ScheduleScreen.tsx` | 0 | 0 | 1 | 0 | 0 |
| `ScheduleTemplateScreen.tsx` | 0 | 0 | 1 | 0 | 0 |
| `SecurityScreen.tsx` | 0 | 0 | 1 | 0 | 0 |
| `SettingsScreen.tsx` | 0 | 0 | 2 | 0 | 0 |
| `SetupScreen.tsx` | 0 | 0 | 2 | 0 | 1 |
| `StudentsCard.tsx` | 0 | 0 | 4 | 0 | 0 |
| `SubmittedWorksScreen.tsx` | 0 | 0 | 0 | 1 | 0 |
| `SubstitutionsScreen.tsx` | 0 | 0 | 1 | 0 | 0 |
| `UsersScreen.tsx` | 0 | 0 | 2 | 0 | 0 |
