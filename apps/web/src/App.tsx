import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { AppLayout } from './components/AppLayout';
import { NotFoundPage, PageGuard } from './components/PageGuard';
import { AcademicContextProvider } from './components/AcademicContext';
import { AppearanceProvider } from './components/AppearanceContext';
import { Alert } from './components/ui';
import { errorMessage } from './lib/api-client';
import { useSession, useSetupStatus } from './lib/queries';
import { AcademicProcessScreen } from './screens/AcademicProcessScreen';
import { CatalogsScreen } from './screens/CatalogsScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { LoginScreen } from './screens/LoginScreen';
import { LessonJournalScreen } from './screens/LessonJournalScreen';
import { LessonsScreen } from './screens/LessonsScreen';
import { GradesAttendanceScreen } from './screens/GradesAttendanceScreen';
import { MyHomeworkScreen } from './screens/MyHomeworkScreen';
import { SubmittedWorksScreen } from './screens/SubmittedWorksScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { PrivacyScreen } from './screens/PrivacyScreen';
import { ScheduleScreen } from './screens/ScheduleScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SetupScreen } from './screens/SetupScreen';
import { UsersScreen } from './screens/UsersScreen';
import type { BrandingDto, SessionResponseDto } from '@edu-diary/contracts';

/**
 * Точка сборки интерфейса.
 *
 * Порядок состояний: не настроено → мастер; нет сессии → вход; иначе —
 * приложение с навигацией. Роутер отвечает только за внутренние разделы.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /**
       * Повторяем **только серверные сбои** (`5xx`) и сетевые ошибки.
       *
       * Решение владельца. Раньше повторялась любая ошибка, и `403`/`400` уходили в
       * консоль дважды: ответ на них не изменится, а шум удваивался. Ошибки без статуса
       * (обрыв сети, таймаут) повторяем: они бывают временными.
       */
      retry: (failureCount: number, error: unknown) => {
        if (failureCount >= 1) return false;
        const status = (error as { status?: number } | null)?.status;
        return status === undefined || status >= 500;
      },
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

function Splash() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <p className="text-slate-500">Загружаем…</p>
    </main>
  );
}

/** Экраны, которым нужна сессия, получают её из кеша запросов. */
function withSession(render: (session: SessionResponseDto) => ReactNode): () => ReactNode {
  return function SessionBoundScreen() {
    const session = useSession();

    if (session.data == null) return <Splash />;

    /**
     * Гейт доступа: экран не монтируется, если раздел роли не положен.
     *
     * Раньше закрытый раздел открывался по прямой ссылке — экран рисовался, запросы
     * уходили и получали `403`. Правила берутся из общего списка (`lib/access`), того же,
     * что питает меню: видимость пункта и доступ к адресу не могут разойтись.
     */
    return <PageGuard session={session.data}>{render(session.data)}</PageGuard>;
  };
}

function RootComponent() {
  const session = useSession();
  const setup = useSetupStatus();

  if (session.data == null || setup.data == null) return <Splash />;

  // Контекст учебного процесса нужен шапке (переключатель года и группы) и
  // разделам: собирается один раз на всё приложение.
  return (
    <AppearanceProvider>
      <AcademicContextProvider session={session.data}>
        <AppLayout session={session.data} branding={setup.data.branding} />
      </AcademicContextProvider>
    </AppearanceProvider>
  );
}

const rootRoute = createRootRoute({ component: RootComponent });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: withSession((session) => <DashboardScreen session={session} />),
});

const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/users',
  component: withSession((session) => <UsersScreen session={session} />),
});

const privacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/privacy',
  component: withSession(() => <PrivacyScreen />),
});

/** «Аудит» и «Безопасность» переехали в «Настройки»: адреса ведут туда. */
const legacyAuditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/audit',
  beforeLoad: () => {
    throw redirect({ to: '/settings' });
  },
});

const legacySecurityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/security',
  beforeLoad: () => {
    throw redirect({ to: '/settings' });
  },
});

/**
 * «Учебный процесс»: годы, группы, ученики и назначения на одной странице.
 *
 * Раньше это были три пункта меню — «Учебный год», «Группы и ученики», «Назначения». Работа идёт
 * по одной цепочке, и три перехода между связанными разделами только мешали.
 */
const academicProcessRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/academic-process',
  /** Ссылка из «Уроков» приводит уже выбранный урок: он раскрывает раздел «Замены». */
  validateSearch: (search: Record<string, unknown>) => ({
    substitutionLessonId:
      typeof search.substitutionLessonId === 'string' ? search.substitutionLessonId : undefined,
  }),
  component: withSession((session) => {
    const search = academicProcessRoute.useSearch();

    return (
      <AcademicProcessScreen
        session={session}
        substitutionLessonId={search.substitutionLessonId ?? null}
      />
    );
  }),
});

/**
 * Старые адреса ведут на объединённую страницу.
 *
 * Закладки на «Учебный год» и «Группы и ученики» продолжают работать: удалять адреса без
 * перенаправления значит отдавать «страница не найдена» тем, кто ими пользовался.
 */
const legacyAcademicsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/academics',
  beforeLoad: () => {
    throw redirect({ to: '/academic-process', search: { substitutionLessonId: undefined } });
  },
});

const legacyGroupsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/groups',
  beforeLoad: () => {
    throw redirect({ to: '/academic-process', search: { substitutionLessonId: undefined } });
  },
});

const catalogsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/catalogs',
  component: withSession(() => <CatalogsScreen />),
});

const legacyAssignmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/assignments',
  beforeLoad: () => {
    throw redirect({ to: '/academic-process', search: { substitutionLessonId: undefined } });
  },
});

const scheduleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/schedule',
  component: withSession((session) => <ScheduleScreen session={session} />),
});

/** «Сетка (шаблон)» стала разделом «Шаблон недели» внутри «Учебного процесса». */
const legacyTemplateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/schedule/template',
  beforeLoad: () => {
    throw redirect({ to: '/academic-process', search: { substitutionLessonId: undefined } });
  },
});

/** «Замены» стала разделом внутри «Учебного процесса»; выбранный урок переносим в новый адрес. */
const legacySubstitutionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/substitutions',
  validateSearch: (search: Record<string, unknown>) => ({
    lessonId: typeof search.lessonId === 'string' ? search.lessonId : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/academic-process',
      search: { substitutionLessonId: search.lessonId },
    });
  },
});

const lessonsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/lessons',
  component: withSession((session) => <LessonsScreen session={session} />),
});

/** Журнал урока: оценки и посещаемость конкретного занятия. */
const lessonJournalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/lessons/$lessonId',
  component: withSession((session) => <LessonJournalScreen session={session} />),
});

/** «Мои задания»: ученик и представитель видят задания своих групп. */
const homeworkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/homework',
  component: withSession(() => <MyHomeworkScreen />),
});

/** Профиль: данные учётной записи, смена пароля и права. */
const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile',
  component: withSession((session) => <ProfileScreen session={session} />),
});

/** «Сданные работы»: проверяющий видит таблицу класса по заданиям. */
const submittedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/submitted',
  component: withSession((session) => <SubmittedWorksScreen session={session} />),
});

/** «Оценки и посещение»: отчёт за текущий учебный период. */
const analyticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/analytics',
  component: withSession((session) => <GradesAttendanceScreen session={session} />),
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: withSession(() => <SettingsScreen />),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  academicProcessRoute,
  /** Старые адреса: работают, но ведут на объединённую страницу. */
  legacyAcademicsRoute,
  legacyGroupsRoute,
  legacyAssignmentsRoute,
  legacyTemplateRoute,
  legacySubstitutionsRoute,
  catalogsRoute,
  scheduleRoute,
  homeworkRoute,
  submittedRoute,
  profileRoute,
  analyticsRoute,
  lessonsRoute,
  lessonJournalRoute,
  usersRoute,
  privacyRoute,
  legacyAuditRoute,
  legacySecurityRoute,
  settingsRoute,
]);

const router = createRouter({
  routeTree,
  defaultPreload: false,
  /** Неизвестный адрес выглядит так же, как закрытый раздел (решение владельца). */
  defaultNotFoundComponent: NotFoundPage,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

function AuthenticatedApp({ branding }: { branding: BrandingDto }) {
  const session = useSession();

  if (session.isLoading) return <Splash />;
  if (session.data == null) return <LoginScreen branding={branding} />;

  return <RouterProvider router={router} />;
}

function AppGate() {
  const setup = useSetupStatus();

  if (setup.isLoading) return <Splash />;

  if (setup.isError || setup.data === undefined) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-6">
        <Alert tone="error">
          Не удалось получить состояние системы: {errorMessage(setup.error)}
        </Alert>
        <p className="text-sm text-slate-500">
          Проверьте, что API запущен и база данных доступна, затем обновите страницу.
        </p>
      </main>
    );
  }

  if (!setup.data.initialized) return <SetupScreen status={setup.data} />;

  return <AuthenticatedApp branding={setup.data.branding} />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppGate />
    </QueryClientProvider>
  );
}
