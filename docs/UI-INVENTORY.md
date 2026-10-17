# Замеры интерфейса

Отчёт **генерируется**: `npm run ui:inventory`. Руками не правится — правки затрутся при
следующем запуске, а числа разойдутся с кодом.

Файлов `.tsx`: **42** (экранов: 24), строк: 13046.

## Примитивы: что уже есть

| Объект | Использований | Файлов |
| --- | --- | --- |
| Button | 169 | 27 |
| Field | 197 | 25 |
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
| <select> | 49 | 22 |
| <textarea> | 8 | 4 |
| input[type=checkbox] | 15 | 11 |
| input[type=file] | 6 | 4 |
| <input> без type | 2 | 2 |

Сырых контролов всего: **80**. Рамка поля ввода `rounded-md border border-slate-300` скопирована руками
**51** раз в 24 файлах — это один и тот же класс, повторённый
по месту.

## Дыра вторая: отступы без правила

| Отступ между блоками | Раз |
| --- | --- |
| flex flex-col gap-4 | 24 |
| flex flex-col gap-3 | 22 |
| flex flex-col gap-1 | 15 |
| flex flex-col gap-6 | 13 |
| flex flex-col gap-2 | 11 |
| flex flex-col gap-0 | 3 |
| flex flex-col gap-5 | 1 |

| Внутренний отступ | Раз |
| --- | --- |
| p-4 | 23 |
| p-3 | 16 |
| p-6 | 7 |
| p-2 | 2 |
| p-5 | 1 |

| Высота контрола | Раз |
| --- | --- |
| py-2 | 162 |
| py-1 | 22 |
| py-0.5 | 5 |
| py-3 | 2 |

| Радиус | Раз |
| --- | --- |
| rounded-md | 92 |
| rounded | 18 |
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
| text-blue-700 underline | 7 |
| cursor-pointer text-blue-700 | 1 |
| activeProps (навигация) | 2 |
| <Link | 3 |

## Акценты: сколько «главных» цветов

| Токен | Раз | Файлов |
| --- | --- | --- |
| bg-blue-700 | 1 | 1 |
| bg-slate-900 | 6 | 3 |
| bg-red-700 | 1 | 1 |
| bg-white | 9 | 5 |

Семейства цветов:

| Семейство | Раз |
| --- | --- |
| slate | 400 |
| amber | 23 |
| red | 20 |
| sky | 18 |
| blue | 14 |
| emerald | 7 |
| green | 7 |

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
Элементов глубже пятого уровня: **282**.

| Уровень | Элементов |
| --- | --- |
| 1 | 134 |
| 2 | 299 |
| 3 | 419 |
| 4 | 424 |
| 5 | 368 |
| 6 | 159 |
| 7 | 49 |
| 8 | 14 |
| 9 | 18 |
| 10 | 22 |
| 11 | 15 |
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
| `components/Spoiler.tsx` | 8 |
| `screens/ScheduleTemplateScreen.tsx` | 8 |
| `components/ui.tsx` | 7 |
| `screens/AcademicsScreen.tsx` | 7 |
| `screens/CatalogsScreen.tsx` | 7 |
| `screens/GroupsScreen.tsx` | 7 |
| `screens/SettingsScreen.tsx` | 7 |

## Экраны: где расхождений больше

Отсортировано по сумме «сырые контролы + скопированная рамка».

| Экран | Сырых контролов | Рамка | Card | Section | Заголовков |
| --- | --- | --- | --- | --- | --- |
| `GradesAttendanceScreen.tsx` | 6 | 4 | 10 | 0 | 3 |
| `ScheduleTemplateScreen.tsx` | 7 | 2 | 1 | 0 | 0 |
| `AssignmentsScreen.tsx` | 4 | 4 | 2 | 0 | 0 |
| `PrivacyScreen.tsx` | 4 | 4 | 4 | 0 | 0 |
| `CatalogsScreen.tsx` | 4 | 3 | 5 | 0 | 0 |
| `LessonsScreen.tsx` | 6 | 1 | 1 | 0 | 0 |
| `StudentsCard.tsx` | 4 | 3 | 4 | 0 | 0 |
| `LessonJournalScreen.tsx` | 4 | 1 | 5 | 0 | 0 |
| `SubstitutionsScreen.tsx` | 3 | 2 | 1 | 0 | 0 |
| `MyHomeworkScreen.tsx` | 3 | 1 | 4 | 0 | 0 |
| `NewGuardianCard.tsx` | 2 | 2 | 0 | 0 | 0 |
| `SettingsScreen.tsx` | 3 | 1 | 2 | 0 | 0 |
| `AcademicsScreen.tsx` | 2 | 1 | 3 | 0 | 0 |
| `SubmittedWorksScreen.tsx` | 1 | 2 | 0 | 1 | 0 |
| `GroupsScreen.tsx` | 1 | 1 | 3 | 0 | 0 |
| `ScheduleScreen.tsx` | 1 | 1 | 1 | 0 | 0 |
| `SecurityScreen.tsx` | 1 | 1 | 1 | 0 | 0 |
| `SetupScreen.tsx` | 1 | 1 | 2 | 0 | 1 |
| `UsersScreen.tsx` | 2 | 0 | 2 | 0 | 0 |
| `AuditScreen.tsx` | 1 | 0 | 1 | 0 | 0 |
| `AcademicProcessScreen.tsx` | 0 | 0 | 0 | 0 | 0 |
| `DashboardScreen.tsx` | 0 | 0 | 2 | 0 | 0 |
| `LoginScreen.tsx` | 0 | 0 | 1 | 0 | 1 |
| `ProfileScreen.tsx` | 0 | 0 | 0 | 3 | 0 |
