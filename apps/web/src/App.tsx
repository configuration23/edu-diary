import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { AppLayout } from './components/AppLayout';
import { AcademicContextProvider } from './components/AcademicContext';
import { Alert } from './components/ui';
import { errorMessage } from './lib/api-client';
import { useSession, useSetupStatus } from './lib/queries';
import { AcademicsScreen } from './screens/AcademicsScreen';
import { AssignmentsScreen } from './screens/AssignmentsScreen';
import { AuditScreen } from './screens/AuditScreen';
import { CatalogsScreen } from './screens/CatalogsScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { GroupsScreen } from './screens/GroupsScreen';
import { LoginScreen } from './screens/LoginScreen';
import { PrivacyScreen } from './screens/PrivacyScreen';
import { SecurityScreen } from './screens/SecurityScreen';
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
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 },
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
    return render(session.data);
  };
}

function RootComponent() {
  const session = useSession();
  const setup = useSetupStatus();

  if (session.data == null || setup.data == null) return <Splash />;

  // Контекст учебного процесса нужен шапке (переключатель года и группы) и
  // разделам: собирается один раз на всё приложение.
  return (
    <AcademicContextProvider session={session.data}>
      <AppLayout session={session.data} branding={setup.data.branding} />
    </AcademicContextProvider>
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
  component: PrivacyScreen,
});

const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/audit',
  component: AuditScreen,
});

const securityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/security',
  component: SecurityScreen,
});

const academicsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/academics',
  component: AcademicsScreen,
});

const groupsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/groups',
  component: GroupsScreen,
});

const catalogsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/catalogs',
  component: CatalogsScreen,
});

const assignmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/assignments',
  component: withSession((session) => <AssignmentsScreen session={session} />),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsScreen,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  academicsRoute,
  groupsRoute,
  catalogsRoute,
  assignmentsRoute,
  usersRoute,
  privacyRoute,
  auditRoute,
  securityRoute,
  settingsRoute,
]);

const router = createRouter({ routeTree, defaultPreload: false });

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
