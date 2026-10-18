import {
  academicYearSchema,
  bellScheduleSchema,
  generateLessonsResponseSchema,
  lessonGenerationPreviewSchema,
  lessonSchema,
  listLessonsResponseSchema,
  listScheduleExceptionsResponseSchema,
  listScheduleResponseSchema,
  scheduleEntrySchema,
  substitutionSchema,
  academicYearWithPeriodsSchema,
  assignmentSchema,
  brandingSchema,
  consentSchema,
  enrollmentSchema,
  enrollStudentResponseSchema,
  gradeCategorySchema,
  healthResponseSchema,
  listAcademicYearsResponseSchema,
  listAssignmentsResponseSchema,
  listAuditResponseSchema,
  listConsentsResponseSchema,
  listEnrollmentsResponseSchema,
  listGradeCategoriesResponseSchema,
  listSignRulesResponseSchema,
  signRuleSchema,
  listGuardianLinksResponseSchema,
  listBellsResponseSchema,
  listGroupOptionsResponseSchema,
  listGroupsResponseSchema,
  listPermissionsResponseSchema,
  listRolesResponseSchema,
  listRoomsResponseSchema,
  listSecurityEventsResponseSchema,
  listStudentsResponseSchema,
  aboutSchema,
  appearanceSchema,
  listSubjectsResponseSchema,
  listSubstituteCandidatesResponseSchema,
  listSubstitutionsResponseSchema,
  listUsersResponseSchema,
  periodSchema,
  policyResponseSchema,
  roomSchema,
  sessionResponseSchema,
  setupStatusResponseSchema,
  studentSummarySchema,
  studentsWithoutConsentResponseSchema,
  studyGroupSchema,
  subjectSchema,
  suggestUsernameResponseSchema,
  userSummarySchema,
  lessonHomeworkFlagsResponseSchema,
  listAssignmentSubmissionsResponseSchema,
  listNewsResponseSchema,
  lessonHomeworkResponseSchema,
  listHomeworkResponseSchema,
  submissionStateSchema,
  listSubmissionsResponseSchema,
  storageSettingsSchema,
  storageTestResultSchema,
  uploadFileResponseSchema,
  type LessonDto,
  type SessionResponseDto,
  type SetupStatusResponseDto,
  type UpdateStorageSettingsRequest,
  type ThemePreference,
  type ViewMode,
} from '@edu-diary/contracts';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { z } from 'zod';

import { apiRequest, apiSend, isUnauthorized } from './api-client';

/** Запросы к API и кеш TanStack Query (ARCHITECTURE.md §2). */

export const queryKeys = {
  setup: ['setup'] as const,
  session: ['session'] as const,
  health: ['health'] as const,
  users: (params: string) => ['users', params] as const,
  roles: ['roles'] as const,
  permissions: ['permissions'] as const,
  audit: (params: string) => ['audit', params] as const,
  security: (params: string) => ['security', params] as const,
  policy: ['policy'] as const,
  consents: (params: string) => ['consents', params] as const,
  missingConsents: ['consents', 'missing'] as const,
  students: (params: string) => ['students', params] as const,
  academicYears: ['academic-years'] as const,
  academicYear: (id: string) => ['academic-years', id] as const,
  periods: (params: string) => ['periods', params] as const,
  groups: (params: string) => ['groups', params] as const,
  group: (id: string) => ['groups', id] as const,
  enrollments: (groupId: string) => ['groups', groupId, 'enrollments'] as const,
  subjects: ['subjects'] as const,
  rooms: ['rooms'] as const,
  gradeCategories: ['grade-categories'] as const,
  assignments: (params: string) => ['assignments', params] as const,
  branding: ['branding'] as const,
};

function toQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }

  const result = search.toString();
  return result === '' ? '' : `?${result}`;
}

export function useSetupStatus(): UseQueryResult<SetupStatusResponseDto> {
  return useQuery({
    queryKey: queryKeys.setup,
    queryFn: () => apiRequest('/api/setup/status', setupStatusResponseSchema),
    retry: false,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => apiRequest('/api/health', healthResponseSchema),
    retry: false,
    refetchInterval: 30_000,
  });
}

/** Текущая сессия; null — пользователь не вошёл. */
export function useSession(
  options: { enabled?: boolean } = {},
): UseQueryResult<SessionResponseDto | null> {
  return useQuery({
    queryKey: queryKeys.session,
    enabled: options.enabled ?? true,
    queryFn: async () => {
      try {
        return await apiRequest('/api/auth/me', sessionResponseSchema);
      } catch (error) {
        if (isUnauthorized(error)) return null;
        throw error;
      }
    },
    retry: false,
  });
}

export function useLogin(): UseMutationResult<
  SessionResponseDto,
  Error,
  { username: string; password: string }
> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input) =>
      apiRequest('/api/auth/login', sessionResponseSchema, { method: 'POST', body: input }),
    onSuccess: () => client.invalidateQueries(),
  });
}

export function useLogout(): UseMutationResult<void, Error, void> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () => apiSend('/api/auth/logout', { method: 'POST' }),
    /**
     * После выхода убираем данные предыдущего пользователя, но оставляем запрос сессии.
     *
     * `invalidateQueries` данные сохраняет: все старые запросы уходят без сессии и
     * получают семь-восемь ответов 401 подряд, а следующий пользователь на мгновение
     * видит чужой журнал. `clear()` убирает и запрос сессии, а по нему приложение
     * решает показать экран входа: выход тотчас зависал на «Загружаем…» — проверено.
     *
     * Поэтому снимаем все данные, кроме сессии, и сразу записываем «сессии нет»:
     * экран входа появляется без обращения к серверу.
     */
    onSuccess: () => {
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      // Записываем «сессии нет» как свежий ответ: иначе запрос тотчас уйдёт на сервер
      // и получит ожидаемый, но лишний 401.
      client.setQueryData(['session'], null, { updatedAt: Date.now() });
    },
  });
}

/**
 * Смена темы оформления.
 *
 * Сессия — источник истины для темы, поэтому после успеха обновляем её кэш: иначе переключатель
 * показывал бы прежнее значение до перезагрузки страницы.
 */
export function useUpdateTheme(): UseMutationResult<void, Error, { theme: ThemePreference }> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input) => apiSend('/api/auth/theme', { method: 'PUT', body: input }),
    onSuccess: (_data, variables) => {
      client.setQueryData<SessionResponseDto>(['session'], (current) =>
        current === undefined
          ? current
          : { ...current, user: { ...current.user, theme: variables.theme } },
      );
    },
  });
}

/**
 * Смена вида страниц: компактно (спойлеры) или развёрнуто (блоки подряд).
 *
 * Как и тема, значение приходит из сессии — поэтому после успеха обновляем её кэш, иначе
 * переключатель показывал бы прежнее значение до перезагрузки.
 */
export function useUpdateViewMode(): UseMutationResult<void, Error, { viewMode: ViewMode }> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input) => apiSend('/api/auth/view-mode', { method: 'PUT', body: input }),
    onSuccess: (_data, variables) => {
      client.setQueryData<SessionResponseDto>(['session'], (current) =>
        current === undefined
          ? current
          : { ...current, user: { ...current.user, viewMode: variables.viewMode } },
      );
    },
  });
}

export function useChangePassword(): UseMutationResult<
  void,
  Error,
  { currentPassword: string; newPassword: string }
> {
  return useMutation({
    mutationFn: (input) => apiSend('/api/auth/change-password', { method: 'POST', body: input }),
  });
}

export function useCompleteSetup(): UseMutationResult<void, Error, unknown> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input) => apiSend('/api/setup/complete', { method: 'POST', body: input }),
    onSuccess: () => client.invalidateQueries(),
  });
}

export function useUsers(params: {
  search?: string;
  role?: string;
  limit?: number;
  offset?: number;
}): UseQueryResult<z.infer<typeof listUsersResponseSchema>> {
  const query = toQueryString({ ...params, limit: params.limit ?? 100 });

  return useQuery({
    queryKey: queryKeys.users(query),
    queryFn: () => apiRequest(`/api/users${query}`, listUsersResponseSchema),
  });
}

export function useRoles() {
  return useQuery({
    queryKey: queryKeys.roles,
    queryFn: () => apiRequest('/api/roles', listRolesResponseSchema),
  });
}

export function usePermissions() {
  return useQuery({
    queryKey: queryKeys.permissions,
    queryFn: () => apiRequest('/api/permissions', listPermissionsResponseSchema),
  });
}

function invalidateUsers(client: ReturnType<typeof useQueryClient>): void {
  void client.invalidateQueries({ queryKey: ['users'] });
  void client.invalidateQueries({ queryKey: queryKeys.roles });
}

export function useCreateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      username: string;
      fullName: string;
      password: string;
      roles: string[];
      email?: string;
      phone?: string;
    }) => apiRequest('/api/users', userSummarySchema, { method: 'POST', body: input }),
    onSuccess: () => invalidateUsers(client),
  });
}

export function useSetUserRoles() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; roles: string[] }) =>
      apiSend(`/api/users/${input.userId}/roles`, { method: 'POST', body: { roles: input.roles } }),
    onSuccess: () => invalidateUsers(client),
  });
}

export function useDeactivateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; isActive: boolean }) =>
      apiSend(`/api/users/${input.userId}`, {
        method: 'PATCH',
        body: { isActive: input.isActive },
      }),
    onSuccess: () => invalidateUsers(client),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (input: { userId: string; password: string }) =>
      apiSend(`/api/users/${input.userId}/reset-password`, {
        method: 'POST',
        body: { password: input.password },
      }),
  });
}

export function useAudit(params: {
  entityKind?: string;
  action?: string;
  accessOnly?: boolean;
  limit?: number;
  offset?: number;
}): UseQueryResult<z.infer<typeof listAuditResponseSchema>> {
  const query = toQueryString({ ...params, limit: params.limit ?? 100 });

  return useQuery({
    queryKey: queryKeys.audit(query),
    queryFn: () => apiRequest(`/api/audit${query}`, listAuditResponseSchema),
  });
}

export function useSecurityEvents(params: {
  severity?: string;
  acknowledged?: boolean;
  limit?: number;
}): UseQueryResult<z.infer<typeof listSecurityEventsResponseSchema>> {
  const query = toQueryString({ ...params, limit: params.limit ?? 100 });

  return useQuery({
    queryKey: queryKeys.security(query),
    queryFn: () => apiRequest(`/api/security/events${query}`, listSecurityEventsResponseSchema),
  });
}

export function useAcknowledgeEvent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { eventId: string; resolution?: string }) =>
      apiSend(`/api/security/events/${input.eventId}/ack`, {
        method: 'POST',
        body: input.resolution === undefined ? {} : { resolution: input.resolution },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['security'] }),
  });
}

export function usePolicy() {
  return useQuery({
    queryKey: queryKeys.policy,
    queryFn: () => apiRequest('/api/privacy-policy', policyResponseSchema),
  });
}

export function usePublishPolicy() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { version: string; text: string }) =>
      apiSend('/api/privacy-policy', { method: 'PUT', body: input }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.policy }),
  });
}

export function useConsents(params: { studentId?: string; limit?: number }) {
  const query = toQueryString({ ...params, limit: params.limit ?? 100 });

  return useQuery({
    queryKey: queryKeys.consents(query),
    queryFn: () => apiRequest(`/api/consents${query}`, listConsentsResponseSchema),
  });
}

export function useMissingConsents() {
  return useQuery({
    queryKey: queryKeys.missingConsents,
    queryFn: () => apiRequest('/api/consents/missing', studentsWithoutConsentResponseSchema),
  });
}

function invalidateConsents(client: ReturnType<typeof useQueryClient>): void {
  void client.invalidateQueries({ queryKey: ['consents'] });
}

export function useCreateConsent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      studentId: string;
      guardianUserId: string;
      grantedVia: 'paper' | 'electronic';
      documentRef?: string;
    }) => apiRequest('/api/consents', consentSchema, { method: 'POST', body: input }),
    onSuccess: () => invalidateConsents(client),
  });
}

export function useRevokeConsent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { consentId: string; reason: string }) =>
      apiSend(`/api/consents/${input.consentId}/revoke`, {
        method: 'POST',
        body: { reason: input.reason },
      }),
    onSuccess: () => invalidateConsents(client),
  });
}

export function useStudents(params: { search?: string; limit?: number; offset?: number }) {
  const query = toQueryString({ ...params, limit: params.limit ?? 100 });

  return useQuery({
    queryKey: queryKeys.students(query),
    queryFn: () => apiRequest(`/api/students${query}`, listStudentsResponseSchema),
  });
}

function invalidateStudents(client: ReturnType<typeof useQueryClient>): void {
  void client.invalidateQueries({ queryKey: ['students'] });
  void client.invalidateQueries({ queryKey: ['consents'] });
}

export function useCreateStudent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      fullName: string;
      birthDate?: string;
      note?: string;
      /** Учётная запись создаётся по необходимости, вместе с карточкой ученика. */
      account?: { username: string; password: string; email?: string; phone?: string } | undefined;
    }) => apiRequest('/api/students', studentSummarySchema, { method: 'POST', body: input }),
    onSuccess: () => invalidateStudents(client),
  });
}

/** Правка карточки ученика: дата рождения и примечание — остальное меняется редко. */
export function useUpdateStudent() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: { studentId: string; birthDate?: string | null; note?: string | null }) =>
      apiRequest(`/api/students/${input.studentId}`, studentSummarySchema, {
        method: 'PATCH',
        body: {
          ...(input.birthDate === undefined ? {} : { birthDate: input.birthDate }),
          ...(input.note === undefined ? {} : { note: input.note }),
        },
      }),
    onSuccess: () => invalidateStudents(client),
  });
}

/** Учётная запись ученику, заведённому ранее (карточкой без учётки). */
export function useCreateStudentAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      studentId: string;
      username: string;
      password: string;
      email?: string;
      phone?: string;
    }) =>
      apiRequest(`/api/students/${input.studentId}/account`, studentSummarySchema, {
        method: 'POST',
        body: {
          username: input.username,
          password: input.password,
          ...(input.email === undefined ? {} : { email: input.email }),
          ...(input.phone === undefined ? {} : { phone: input.phone }),
        },
      }),
    onSuccess: () => invalidateStudents(client),
  });
}

/** Свободный логин по ФИО: транслитерация и занятость считаются на сервере. */
export function useSuggestUsername() {
  return useMutation({
    mutationFn: (fullName: string) =>
      apiRequest(
        `/api/users/suggest-username?${toQueryString({ fullName })}`,
        suggestUsernameResponseSchema,
      ),
  });
}

export function useLinkGuardian() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { studentId: string; guardianUserId: string; relation?: string }) =>
      apiSend(`/api/students/${input.studentId}/guardians`, {
        method: 'POST',
        body: {
          guardianUserId: input.guardianUserId,
          ...(input.relation === undefined ? {} : { relation: input.relation }),
        },
      }),
    onSuccess: () => {
      invalidateStudents(client);
      // Инвалидируем и общий список, и выборки по конкретному ученику.
      void client.invalidateQueries({ queryKey: ['guardian-links'] });
    },
  });
}

/** Все связи «ученик ↔ представитель»: список в разделе «Учётные записи и роли». */
export function useGuardianLinks(studentId?: string) {
  const query = toQueryString({ limit: 200, ...(studentId === undefined ? {} : { studentId }) });

  return useQuery({
    queryKey: ['guardian-links', studentId ?? 'all'],
    queryFn: () => apiRequest(`/api/guardian-links${query}`, listGuardianLinksResponseSchema),
  });
}

/** Отвязка представителя: ученик и представитель перестают быть связаны. */
export function useUnlinkGuardian() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { studentId: string; linkId: string }) =>
      apiSend(`/api/students/${input.studentId}/guardians/${input.linkId}`, {
        method: 'DELETE',
      }).then(() => input.linkId),
    onSuccess: () => {
      invalidateStudents(client);
      // Инвалидируем и общий список, и выборки по конкретному ученику.
      void client.invalidateQueries({ queryKey: ['guardian-links'] });
    },
  });
}

export function useStudentGuardians(studentId: string | null) {
  return useQuery({
    queryKey: ['students', studentId ?? '', 'guardians'],
    enabled: studentId !== null,
    queryFn: () =>
      apiRequest(
        `/api/students/${studentId ?? ''}/guardians`,
        z.object({
          items: z.array(
            z.object({
              id: z.uuid(),
              guardianUserId: z.uuid(),
              guardianName: z.string(),
              guardianUsername: z.string(),
              relation: z.string().nullable(),
            }),
          ),
        }),
      ),
  });
}

export function useAcademicYears(
  /** Выключить запрос, когда роли справочник учебных годов недоступен. */
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: queryKeys.academicYears,
    enabled: options.enabled ?? true,
    queryFn: () => apiRequest('/api/academic-years', listAcademicYearsResponseSchema),
  });
}

export function usePeriods() {
  return useQuery({
    queryKey: queryKeys.periods(''),
    queryFn: () => apiRequest('/api/periods', z.object({ items: z.array(periodSchema) })),
  });
}

// --- Этап 2: учебные годы, группы, справочники, назначения, брендинг ---

/** Год вместе с его периодами: экран «Учебный год» открывается одним запросом. */
export function useAcademicYear(id: string | null) {
  return useQuery({
    queryKey: queryKeys.academicYear(id ?? ''),
    enabled: id !== null,
    queryFn: () => apiRequest(`/api/academic-years/${id ?? ''}`, academicYearWithPeriodsSchema),
  });
}

function invalidateAcademics(client: ReturnType<typeof useQueryClient>): void {
  void client.invalidateQueries({ queryKey: ['academic-years'] });
  void client.invalidateQueries({ queryKey: ['periods'] });
  void client.invalidateQueries({ queryKey: ['groups'] });
  void client.invalidateQueries({ queryKey: ['subjects'] });
  void client.invalidateQueries({ queryKey: ['rooms'] });
  void client.invalidateQueries({ queryKey: ['grade-categories'] });
  void client.invalidateQueries({ queryKey: ['assignments'] });
  void client.invalidateQueries({ queryKey: ['students'] });
}

export function useCreateAcademicYear() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; startsOn: string; endsOn: string; isActive?: boolean }) =>
      apiRequest('/api/academic-years', academicYearSchema, { method: 'POST', body: input }),
    onSuccess: () => invalidateAcademics(client),
  });
}

export function useUpdateAcademicYear() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; title?: string; startsOn?: string; endsOn?: string }) => {
      const { id, ...body } = input;
      return apiRequest(`/api/academic-years/${id}`, academicYearSchema, { method: 'PATCH', body });
    },
    onSuccess: () => invalidateAcademics(client),
  });
}

export function useActivateAcademicYear() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/academic-years/${id}/activate`, academicYearSchema, { method: 'POST' }),
    onSuccess: () => invalidateAcademics(client),
  });
}

export function useCreatePeriod() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      academicYearId: string;
      title: string;
      kind: 'term' | 'semester' | 'quarter';
      startsOn: string;
      endsOn: string;
    }) => apiRequest('/api/periods', periodSchema, { method: 'POST', body: input }),
    onSuccess: () => invalidateAcademics(client),
  });
}

export function useGroups(
  params: { academicYearId?: string; search?: string } = {},
  /** Выключить запрос, когда роль всё равно не имеет доступа к справочнику групп. */
  options: { enabled?: boolean } = {},
) {
  const query = toQueryString(params);

  return useQuery({
    queryKey: queryKeys.groups(query),
    enabled: options.enabled ?? true,
    queryFn: () => apiRequest(`/api/groups${query}`, listGroupsResponseSchema),
  });
}

export function useCreateGroup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      academicYearId: string;
      name: string;
      course?: number | null;
      specialty?: string | null;
      curatorUserId?: string | null;
      startsOn: string;
      endsOn: string;
    }) => apiRequest('/api/groups', studyGroupSchema, { method: 'POST', body: input }),
    onSuccess: () => invalidateAcademics(client),
  });
}

export function useUpdateGroup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      name?: string;
      course?: number | null;
      specialty?: string | null;
      startsOn?: string;
      endsOn?: string;
    }) => {
      const { id, ...body } = input;
      return apiRequest(`/api/groups/${id}`, studyGroupSchema, { method: 'PATCH', body });
    },
    onSuccess: () => invalidateAcademics(client),
  });
}

/** Удаление разрешено только для пустой группы: иначе сервер отвечает 409. */
export function useDeleteGroup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend(`/api/groups/${id}`, { method: 'DELETE' }).then(() => id),
    onSuccess: () => invalidateAcademics(client),
  });
}

export function useGroupEnrollments(groupId: string | null) {
  return useQuery({
    queryKey: queryKeys.enrollments(groupId ?? ''),
    enabled: groupId !== null,
    queryFn: () =>
      apiRequest(`/api/groups/${groupId ?? ''}/students`, listEnrollmentsResponseSchema),
  });
}

export function useEnrollStudent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      groupId: string;
      studentId: string;
      joinedOn: string;
      note?: string | null;
    }) =>
      apiRequest(`/api/groups/${input.groupId}/enrollments`, enrollStudentResponseSchema, {
        method: 'POST',
        body: {
          studentId: input.studentId,
          joinedOn: input.joinedOn,
          ...(input.note === undefined || input.note === null ? {} : { note: input.note }),
        },
      }),
    onSuccess: () => invalidateAcademics(client),
  });
}

export function useWithdrawStudent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { enrollmentId: string; leftOn: string; note?: string | null }) =>
      apiRequest(`/api/enrollments/${input.enrollmentId}`, enrollmentSchema, {
        method: 'PATCH',
        body: {
          leftOn: input.leftOn,
          ...(input.note === undefined || input.note === null ? {} : { note: input.note }),
        },
      }),
    onSuccess: () => invalidateAcademics(client),
  });
}

export function useTransferStudent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { studentId: string; studyGroupId: string; transferOn: string }) =>
      apiRequest(`/api/students/${input.studentId}/transfer`, enrollStudentResponseSchema, {
        method: 'POST',
        body: { studyGroupId: input.studyGroupId, transferOn: input.transferOn },
      }),
    onSuccess: () => invalidateAcademics(client),
  });
}

export function useSubjects() {
  return useQuery({
    queryKey: queryKeys.subjects,
    queryFn: () => apiRequest('/api/subjects', listSubjectsResponseSchema),
  });
}

export function useCreateSubject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      shortName?: string | null;
      kind: 'mandatory' | 'optional' | 'practice';
      color?: string | null;
    }) => apiRequest('/api/subjects', subjectSchema, { method: 'POST', body: input }),
    onSuccess: () => invalidateAcademics(client),
  });
}

export function useDeleteSubject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend(`/api/subjects/${id}`, { method: 'DELETE' }).then(() => id),
    onSuccess: () => invalidateAcademics(client),
  });
}

/**
 * Удаление карточки ученика.
 *
 * Доступно только ученику без учётной записи, согласия и зачислений — проверяет сервер и отвечает
 * понятной причиной отказа. Ошибку показываем на экране, а не глотаем.
 */
export function useDeleteStudent(): UseMutationResult<void, Error, string> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (studentId) => apiSend(`/api/students/${studentId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['students'] });
    },
  });
}

export function useRooms() {
  return useQuery({
    queryKey: queryKeys.rooms,
    queryFn: () => apiRequest('/api/rooms', listRoomsResponseSchema),
  });
}

export function useCreateRoom() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; capacity?: number | null; note?: string | null }) =>
      apiRequest('/api/rooms', roomSchema, { method: 'POST', body: input }),
    onSuccess: () => invalidateAcademics(client),
  });
}

export function useGradeCategories() {
  return useQuery({
    queryKey: queryKeys.gradeCategories,
    queryFn: () => apiRequest('/api/grade-categories', listGradeCategoriesResponseSchema),
  });
}

export function useCreateGradeCategory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { code: string; title: string; weight: number; color?: string | null }) =>
      apiRequest('/api/grade-categories', gradeCategorySchema, { method: 'POST', body: input }),
    onSuccess: () => invalidateAcademics(client),
  });
}

/**
 * Накопительные знаки: сколько плюсов и точек даёт оценку.
 *
 * Награда не настраивается — плюсы дают `5`, точки `2`; правятся только порог и
 * выключатель пересчёта.
 */
export function useSignRules() {
  return useQuery({
    queryKey: ['sign-rules'],
    queryFn: () => apiRequest('/api/sign-rules', listSignRulesResponseSchema),
  });
}

export function useUpdateSignRule() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { sign: 'plus' | 'dot'; threshold?: number; isActive?: boolean }) =>
      apiRequest(`/api/sign-rules/${input.sign}`, signRuleSchema, {
        method: 'PATCH',
        body: {
          ...(input.threshold === undefined ? {} : { threshold: input.threshold }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['sign-rules'] });
      // Порог виден и в журнале урока: там показывается «до оценки осталось N».
      void client.invalidateQueries({ queryKey: ['journal'] });
    },
  });
}

/** Звонки: сетка времени по номеру пары (справочник заведения). */
export function useBells() {
  return useQuery({
    queryKey: ['bells'],
    queryFn: () => apiRequest('/api/bells', listBellsResponseSchema),
  });
}

/** Сохранение звонка: пара уникальна, поэтому одна операция и для создания, и для правки. */
export function useSaveBell() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      pairNumber: number;
      timeStart: string;
      timeEnd: string;
      breakMinutes?: number | null;
    }) => apiRequest('/api/bells', bellScheduleSchema, { method: 'PUT', body: input }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['bells'] });
    },
  });
}

export function useDeleteBell() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (pairNumber: number) =>
      apiSend(`/api/bells/${pairNumber}`, { method: 'DELETE' }).then(() => pairNumber),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['bells'] });
    },
  });
}

export function useUpdateGradeCategory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; title?: string; weight?: number; color?: string | null }) => {
      const { id, ...body } = input;
      return apiRequest(`/api/grade-categories/${id}`, gradeCategorySchema, {
        method: 'PATCH',
        body,
      });
    },
    onSuccess: () => invalidateAcademics(client),
  });
}

export function useDeleteGradeCategory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiSend(`/api/grade-categories/${id}`, { method: 'DELETE' }).then(() => id),
    onSuccess: () => invalidateAcademics(client),
  });
}

export function useUpdateRoom() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      name?: string;
      capacity?: number | null;
      note?: string | null;
    }) => {
      const { id, ...body } = input;
      return apiRequest(`/api/rooms/${id}`, roomSchema, { method: 'PATCH', body });
    },
    onSuccess: () => invalidateAcademics(client),
  });
}

export function useDeleteRoom() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend(`/api/rooms/${id}`, { method: 'DELETE' }).then(() => id),
    onSuccess: () => invalidateAcademics(client),
  });
}

export function useUpdateSubject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      name?: string;
      shortName?: string | null;
      kind?: 'mandatory' | 'optional' | 'practice';
      color?: string | null;
    }) => {
      const { id, ...body } = input;
      return apiRequest(`/api/subjects/${id}`, subjectSchema, { method: 'PATCH', body });
    },
    onSuccess: () => invalidateAcademics(client),
  });
}

export function useUpdatePeriod() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      title?: string;
      kind?: 'term' | 'semester' | 'quarter';
      startsOn?: string;
      endsOn?: string;
    }) => {
      const { id, ...body } = input;
      return apiRequest(`/api/periods/${id}`, periodSchema, { method: 'PATCH', body });
    },
    onSuccess: () => invalidateAcademics(client),
  });
}

export function useDeletePeriod() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend(`/api/periods/${id}`, { method: 'DELETE' }).then(() => id),
    onSuccess: () => invalidateAcademics(client),
  });
}

export function useAssignments(
  params: { teacherUserId?: string; studyGroupId?: string } = {},
  /** Выключить запрос, когда назначения этой роли не нужны. */
  options: { enabled?: boolean } = {},
) {
  const query = toQueryString(params);

  return useQuery({
    queryKey: queryKeys.assignments(query),
    enabled: options.enabled ?? true,
    queryFn: () => apiRequest(`/api/assignments${query}`, listAssignmentsResponseSchema),
  });
}

/**
 * Преподаватели для назначений: список пользователей с ролью `teacher`.
 *
 * Роль приходит в каждой записи, поэтому фильтруем на клиенте — отдельного
 * «списка преподавателей» API не заводит.
 */
export function useTeachers(
  /** Выключить запрос: список учётных записей доступен не всем ролям. */
  options: { enabled?: boolean } = {},
) {
  const query = toQueryString({ limit: 200 });

  return useQuery({
    queryKey: queryKeys.users(query),
    enabled: options.enabled ?? true,
    queryFn: () => apiRequest(`/api/users${query}`, listUsersResponseSchema),
  });
}

export function useCreateAssignment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      teacherUserId: string;
      subjectId: string;
      studyGroupId: string;
      startsOn: string;
      endsOn?: string | null;
      hoursPlanned?: number | null;
    }) => apiRequest('/api/assignments', assignmentSchema, { method: 'POST', body: input }),
    onSuccess: () => invalidateAcademics(client),
  });
}

export function useCloseAssignment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; endsOn: string }) =>
      apiRequest(`/api/assignments/${input.id}/close`, assignmentSchema, {
        method: 'POST',
        body: { endsOn: input.endsOn },
      }),
    onSuccess: () => invalidateAcademics(client),
  });
}

// --- Расписание и уроки (Этап 3) ---

function invalidateSchedule(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: ['schedule'] });
  void client.invalidateQueries({ queryKey: ['lessons'] });
  void client.invalidateQueries({ queryKey: ['substitutions'] });
}

/**
 * Группы, расписание которых доступно смотрящему.
 *
 * Ученик и родитель не имеют права `academics:read@all`, поэтому общий список
 * групп им недоступен: свои группы отдаёт расписание.
 */
export function useScheduleGroups() {
  return useQuery({
    queryKey: ['schedule', 'my-groups'],
    queryFn: () => apiRequest('/api/schedule/my-groups', listGroupOptionsResponseSchema),
  });
}

export function useScheduleEntries(params: { studyGroupId?: string; teacherUserId?: string } = {}) {
  const query = toQueryString(params);

  return useQuery({
    queryKey: ['schedule', query],
    queryFn: () => apiRequest(`/api/schedule${query}`, listScheduleResponseSchema),
  });
}

export function useCreateScheduleEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      assignmentId: string;
      roomId?: string | null;
      dayOfWeek: number;
      pairNumber: number;
      /** Можно не указывать: время возьмётся из звонков. */
      timeStart?: string;
      timeEnd?: string;
      validFrom: string;
      validTo?: string | null;
    }) => apiRequest('/api/schedule', scheduleEntrySchema, { method: 'POST', body: input }),
    onSuccess: () => invalidateSchedule(client),
  });
}

export function useUpdateScheduleEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      roomId?: string | null;
      dayOfWeek?: number;
      pairNumber?: number;
      timeStart?: string;
      timeEnd?: string;
      validFrom?: string;
      validTo?: string | null;
    }) =>
      apiRequest(`/api/schedule/${input.id}`, scheduleEntrySchema, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => invalidateSchedule(client),
  });
}

export function useDeleteScheduleEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend(`/api/schedule/${id}`, { method: 'DELETE' }).then(() => id),
    onSuccess: () => invalidateSchedule(client),
  });
}

export function useLessons(
  params: {
    studyGroupId?: string;
    teacherUserId?: string;
    from?: string;
    to?: string;
    status?: string;
  } = {},
) {
  const query = toQueryString(params);

  return useQuery({
    queryKey: ['lessons', query],
    queryFn: () => apiRequest(`/api/lessons${query}`, listLessonsResponseSchema),
  });
}

export function useGenerateLessons() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      studyGroupId: string;
      from: string;
      to: string;
      /** Стереть уроки периода и создать заново по шаблону. */
      recreate?: boolean;
    }) =>
      apiRequest('/api/lessons/generate', generateLessonsResponseSchema, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => invalidateSchedule(client),
  });
}

/**
 * Предварительный расчёт пересоздания: сколько уроков и замен попадёт под удаление.
 *
 * Запрашивается, когда администратор включает чекбокс «Пересоздать», чтобы
 * предупреждение содержало реальные числа.
 */
export function useGenerationPreview() {
  return useMutation({
    mutationFn: (input: { studyGroupId: string; from: string; to: string }) =>
      apiRequest('/api/lessons/generation-preview', lessonGenerationPreviewSchema, {
        method: 'POST',
        body: input,
      }),
  });
}

/**
 * Урок вручную: внеплановое занятие или правка расписания на неделю.
 *
 * Такой урок не связан с шаблоном, поэтому генерация его не создаёт и не удаляет;
 * пересоздание за период его затрёт (об этом предупреждает форма генерации).
 */
export function useCreateLesson() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      studyGroupId: string;
      subjectId: string;
      teacherUserId: string;
      roomId?: string | null;
      lessonDate: string;
      pairNumber: number;
      timeStart?: string;
      timeEnd?: string;
      topic?: string | null;
    }) => apiRequest('/api/lessons', lessonSchema, { method: 'POST', body: input }),
    onSuccess: () => invalidateSchedule(client),
  });
}

export function useUpdateLesson() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      lessonDate?: string;
      pairNumber?: number;
      timeStart?: string;
      timeEnd?: string;
      topic?: string | null;
      status?: string;
      roomId?: string | null;
    }) => apiRequest(`/api/lessons/${input.id}`, lessonSchema, { method: 'PATCH', body: input }),
    onSuccess: () => invalidateSchedule(client),
  });
}

export function useDeleteLesson() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend(`/api/lessons/${id}`, { method: 'DELETE' }).then(() => id),
    onSuccess: () => invalidateSchedule(client),
  });
}

export function useCreateSubstitution() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      /** На один урок: даты берутся из урока, начало указывать не нужно. */
      lessonId?: string | null;
      assignmentId?: string | null;
      substituteUserId: string;
      startsOn?: string;
      endsOn?: string | null;
      reason: string;
    }) => apiRequest('/api/substitutions', substitutionSchema, { method: 'POST', body: input }),
    onSuccess: () => invalidateSchedule(client),
  });
}

export function useDeleteSubstitution() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiSend(`/api/substitutions/${id}`, { method: 'DELETE' }).then(() => id),
    onSuccess: () => invalidateSchedule(client),
  });
}

/**
 * Кандидаты на замену: активные преподаватели со статусом занятости на слот урока.
 * Свободные приходят первыми — администратор выбирает заменяющего за пару секунд.
 */
export function useSubstituteCandidates(lessonId: string | null) {
  return useQuery({
    queryKey: ['substitute-candidates', lessonId],
    enabled: lessonId !== null,
    queryFn: () =>
      apiRequest(
        `/api/lessons/${String(lessonId)}/substitute-candidates`,
        listSubstituteCandidatesResponseSchema,
      ),
  });
}

/** Журнал замен: список активных замен за период. */
export function useSubstitutions(
  params: { assignmentId?: string; substituteUserId?: string } = {},
) {
  const query = toQueryString(params);

  return useQuery({
    queryKey: ['substitutions', 'journal', query],
    queryFn: () => apiRequest(`/api/substitutions${query}`, listSubstitutionsResponseSchema),
  });
}

/**
 * Восстановление отменённого урока.
 *
 * Отмена — это исключение на дату, а не удаление строки, поэтому возврат состоит
 * из двух шагов: снять исключение и попросить генерацию вернуть урок в план по
 * этой же дате. Широкий период не берём: генерация по одному дню ничего лишнего
 * не пересчитывает.
 */
export function useRestoreLesson() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (lesson: LessonDto) => {
      const exceptions = await apiRequest(
        '/api/schedule/exceptions',
        listScheduleExceptionsResponseSchema,
      );

      const cancellation = exceptions.items.find(
        (item) =>
          item.exceptionDate === lesson.lessonDate &&
          item.action === 'cancel' &&
          item.scheduleEntryId === lesson.scheduleEntryId,
      );

      if (cancellation !== undefined) {
        await apiSend(`/api/schedule/exceptions/${cancellation.id}`, { method: 'DELETE' });
      }

      await apiRequest('/api/lessons/generate', generateLessonsResponseSchema, {
        method: 'POST',
        body: {
          studyGroupId: lesson.studyGroupId,
          from: lesson.lessonDate,
          to: lesson.lessonDate,
        },
      });

      return lesson.id;
    },
    onSuccess: () => invalidateSchedule(client),
  });
}

/**
 * Оформление уроков: значки событий и цвета предметов.
 *
 * Настройка общая для заведения, но читают её все: интерфейс рисует значки по
 * ней. Пока значение не загрузилось, используется DEFAULT_APPEARANCE из
 * контрактов — интерфейс не должен ждать ради оформления.
 */
export function useAppearance() {
  return useQuery({
    queryKey: ['appearance'],
    queryFn: () => apiRequest('/api/settings/appearance', appearanceSchema),
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateAppearance() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      markersEnabled?: boolean;
      markers?: { replaced?: string; cancelled?: string };
      colorsEnabled?: boolean;
    }) => apiRequest('/api/settings/appearance', appearanceSchema, { method: 'PUT', body: input }),
    onSuccess: (data) => {
      client.setQueryData(['appearance'], data);
    },
  });
}

export function useBranding() {
  return useQuery({
    queryKey: queryKeys.branding,
    queryFn: () => apiRequest('/api/settings/branding', brandingSchema),
  });
}

export function useUpdateBranding() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      title?: string | null;
      shortName?: string | null;
      signature?: string | null;
      logoDataUrl?: string | null;
      /** Блок «О колледже»: заголовок и текст. */
      aboutTitle?: string | null;
      aboutText?: string | null;
      /** Показывать блок «Об учебном заведении» на «Обзоре». */
      aboutVisible?: boolean;
    }) => apiRequest('/api/settings/branding', brandingSchema, { method: 'PUT', body: input }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['branding'] });
      void client.invalidateQueries({ queryKey: ['setup'] });
    },
  });
}

/**
 * Настройки хранилища файлов.
 *
 * Это **системные** настройки: адрес хранилища и ключи доступа. Доступны только
 * администратору — директору видеть их незачем (разделение «бизнес и системные настройки»
 * записано в `BACKLOG.md`).
 */
export function useStorageSettings(enabled = true) {
  return useQuery({
    queryKey: ['storage-settings'],
    enabled,
    queryFn: () => apiRequest('/api/settings/storage', storageSettingsSchema),
  });
}

export function useUpdateStorageSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateStorageSettingsRequest) =>
      apiRequest('/api/settings/storage', storageSettingsSchema, { method: 'PUT', body: input }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['storage-settings'] });
    },
  });
}

/**
 * Проверка подключения к хранилищу.
 *
 * Мутация, а не запрос: проверка **пишет настоящий файл** в хранилище, поэтому повторять её
 * при каждом обновлении окна нельзя. Идентификатор ответа не нужен — важен результат.
 */
export function useTestStorage() {
  return useMutation({
    mutationFn: (input: UpdateStorageSettingsRequest) =>
      apiRequest('/api/settings/storage/test', storageTestResultSchema, {
        method: 'POST',
        body: input,
      }),
  });
}

/**
 * Домашнее задание урока.
 *
 * Задание ставится из журнала урока: учителю удобнее работать там, где он ведёт занятие, а
 * ученику — видеть задание в своём списке.
 */
export function useLessonHomework(lessonId: string | null) {
  return useQuery({
    queryKey: ['homework-lesson', lessonId ?? ''],
    enabled: lessonId !== null,
    queryFn: () =>
      apiRequest(`/api/homework/lesson/${lessonId ?? ''}`, lessonHomeworkResponseSchema),
  });
}

export function useCreateHomework() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      lessonId: string;
      text: string;
      dueLessonId?: string | null;
      links?: { url: string; title?: string | null }[];
      fileIds?: string[];
    }) => apiRequest('/api/homework', z.object({ id: z.uuid() }), { method: 'POST', body: input }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['homework-lesson'] });
    },
  });
}

/** Список сдавших: только проверяющим. */
export function useHomeworkSubmissions(assignmentId: string | null) {
  return useQuery({
    queryKey: ['homework-submissions', assignmentId ?? ''],
    enabled: assignmentId !== null,
    queryFn: () =>
      apiRequest(`/api/homework/${assignmentId ?? ''}/submissions`, listSubmissionsResponseSchema),
  });
}

/**
 * Загрузка вложения.
 *
 * Файл загружается **до** сохранения задания: иначе форма ждала бы передачи файла. Имя
 * поля — `file`, как ждёт сервер.
 */
export function useUploadHomeworkFile() {
  return useMutation({
    mutationFn: async (input: { file: File; kind: 'assignment' | 'submission' }) => {
      const body = new FormData();
      body.append('file', input.file);

      const response = await fetch(
        input.kind === 'submission' ? '/api/homework/submission-files' : '/api/homework/files',
        { method: 'POST', body, credentials: 'same-origin' },
      );

      if (!response.ok) {
        const parsed = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(parsed?.error?.message ?? 'Не удалось загрузить файл');
      }

      return uploadFileResponseSchema.parse(await response.json());
    },
  });
}

/**
 * Задания ученика на дату: что задано по его группам.
 *
 * Набор групп определяет **сервер**: у ученика это его группы, у представителя — группы его
 * детей. Подставить чужой идентификатор группы в адресе ничего не даёт.
 */
export function useMyHomework(input: { studyGroupId?: string; from?: string; to?: string } = {}) {
  const query = toQueryString(input);

  return useQuery({
    queryKey: ['my-homework', query],
    queryFn: () => apiRequest(`/api/homework${query}`, listHomeworkResponseSchema),
  });
}

/** Состояние сдачи: сдано ли уже, какой срок, можно ли сдавать. */
export function useSubmissionState(assignmentId: string | null) {
  return useQuery({
    queryKey: ['homework-submission-state', assignmentId ?? ''],
    enabled: assignmentId !== null,
    queryFn: () =>
      apiRequest(`/api/homework/${assignmentId ?? ''}/submission`, submissionStateSchema),
  });
}

export function useSubmitHomework() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { assignmentId: string; text: string; fileIds: string[] }) =>
      apiRequest(
        '/api/homework/' + input.assignmentId + '/submission',
        z.object({ id: z.uuid() }),
        {
          method: 'POST',
          body: { text: input.text, fileIds: input.fileIds },
        },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['homework-submission-state'] });
      void client.invalidateQueries({ queryKey: ['my-homework'] });
    },
  });
}

/**
 * Правка задания.
 *
 * Изменения записываются в аудит: спор «я этого не менял» решается фактами.
 */
export function useUpdateHomework() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      assignmentId: string;
      text?: string;
      /** Урок-срок: `null` — оставить прежний. */
      dueLessonId?: string | null;
      links?: { url: string; title?: string | null }[];
      fileIds?: string[];
      /** Какие из уже приложенных файлов оставить: отсутствие в списке — «убрать». */
      keepFileIds?: string[];
    }) =>
      apiRequest(`/api/homework/${input.assignmentId}`, z.object({ ok: z.boolean() }), {
        method: 'PATCH',
        body: {
          ...(input.text === undefined ? {} : { text: input.text }),
          ...(input.dueLessonId === null || input.dueLessonId === undefined
            ? {}
            : { dueLessonId: input.dueLessonId }),
          ...(input.links === undefined ? {} : { links: input.links }),
          ...(input.fileIds === undefined ? {} : { fileIds: input.fileIds }),
          ...(input.keepFileIds === undefined ? {} : { keepFileIds: input.keepFileIds }),
        },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['homework-lesson'] });
      void client.invalidateQueries({ queryKey: ['my-homework'] });
    },
  });
}

/**
 * Удаление задания.
 *
 * Удаление **мягкое**: задание скрывается у учеников, но история и сдачи остаются. Поэтому
 * подтверждение обязательно — случайное нажатие не должно убирать задание у группы.
 */
export function useRemoveHomework() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) =>
      apiRequest(`/api/homework/${assignmentId}`, z.object({ ok: z.boolean() }), {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['homework-lesson'] });
      void client.invalidateQueries({ queryKey: ['my-homework'] });
    },
  });
}

/**
 * Отметки о домашнем задании для расписания.
 *
 * Одним запросом на все уроки периода: иначе расписание делало бы запрос на каждое занятие.
 * Текст задания здесь не нужен — только «есть ли оно».
 */
export function useHomeworkFlags(lessonIds: string[]) {
  /**
   * Идентификаторы уходят **повторяющимся параметром** (`?lessonIds=a&lessonIds=b`).
   *
   * `URLSearchParams.set` склеил бы массив в одну строку через запятую, и сервер получил бы
   * одно значение вместо списка. Поэтому строку собираем сами.
   */
  const query =
    lessonIds.length === 0
      ? ''
      : `?${lessonIds.map((id) => `lessonIds=${encodeURIComponent(id)}`).join('&')}`;

  return useQuery({
    queryKey: ['homework-flags', query],
    enabled: lessonIds.length > 0,
    queryFn: () =>
      apiRequest(`/api/homework/lesson-flags${query}`, lessonHomeworkFlagsResponseSchema),
  });
}

/**
 * Сданные работы: **таблица класса** по заданиям.
 *
 * Учителю нужен не список сдавших, а таблица: напротив каждого ученика его ответ или пометка
 * «не сдал». Состав группы сервер берёт **на дату урока-срока** — проверяют тех, кто был в
 * группе тогда.
 */
export function useSubmittedWorks(
  input: { studyGroupId?: string; from?: string; to?: string } = {},
) {
  const query = toQueryString(input);

  return useQuery({
    queryKey: ['submitted-works', query],
    queryFn: () =>
      apiRequest(`/api/homework/submissions${query}`, listAssignmentSubmissionsResponseSchema),
  });
}

/**
 * Новости заведения (Этап 6).
 *
 * Читают **все вошедшие**, публикует администратор. Список отдаётся от свежих к старым, поэтому
 * «последняя новость» — это первая в списке: интерфейс не выбирает её сам.
 */
/**
 * Блок «О колледже»: заголовок и текст из настроек заведения.
 *
 * Отдельный запрос, а не брендинг: брендинг требует `academics:read`, и у ученика с представителем
 * «Обзор» отвечал `403`. Здесь только сведения о заведении, они открыты всем вошедшим.
 */
export function useAbout() {
  return useQuery({
    queryKey: ['settings', 'about'],
    queryFn: () => apiRequest('/api/settings/about', aboutSchema),
  });
}

export function useNews(input: { forEditing?: boolean } = {}) {
  const query = toQueryString({ forEditing: input.forEditing === true ? 'true' : undefined });

  return useQuery({
    queryKey: ['news', query],
    queryFn: () => apiRequest(`/api/news${query}`, listNewsResponseSchema),
  });
}

/** Загрузка картинки: файл передаётся **до** сохранения новости, как и вложения заданий. */
export function useUploadNewsImage() {
  return useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append('file', file);

      const response = await fetch('/api/news/images', {
        method: 'POST',
        body,
        credentials: 'same-origin',
      });

      if (!response.ok) {
        const parsed = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(parsed?.error?.message ?? 'Не удалось загрузить картинку');
      }

      return uploadFileResponseSchema.parse(await response.json());
    },
  });
}

export function useCreateNews() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      title: string;
      body: string;
      publishedOn?: string;
      visibleUntil?: string | null;
      imageFileId?: string | null;
      imagePosition?: 'top' | 'bottom';
    }) =>
      apiRequest('/api/news', z.object({ id: z.uuid() }), {
        method: 'POST',
        body: {
          title: input.title,
          body: input.body,
          ...(input.publishedOn === undefined ? {} : { publishedOn: input.publishedOn }),
          ...(input.visibleUntil === undefined ? {} : { visibleUntil: input.visibleUntil }),
          ...(input.imageFileId === undefined ? {} : { imageFileId: input.imageFileId }),
          ...(input.imagePosition === undefined ? {} : { imagePosition: input.imagePosition }),
        },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['news'] });
    },
  });
}

export function useUpdateNews() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      title?: string;
      body?: string;
      publishedOn?: string;
      visibleUntil?: string | null;
      imageFileId?: string | null;
      imagePosition?: 'top' | 'bottom';
    }) =>
      apiSend(`/api/news/${input.id}`, {
        method: 'PATCH',
        body: {
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.body === undefined ? {} : { body: input.body }),
          ...(input.publishedOn === undefined ? {} : { publishedOn: input.publishedOn }),
          ...(input.visibleUntil === undefined ? {} : { visibleUntil: input.visibleUntil }),
          ...(input.imageFileId === undefined ? {} : { imageFileId: input.imageFileId }),
          ...(input.imagePosition === undefined ? {} : { imagePosition: input.imagePosition }),
        },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['news'] });
    },
  });
}

/** Удаление **мягкое**: новость скрывается, но остаётся в истории и аудите. */
export function useRemoveNews() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend(`/api/news/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['news'] });
    },
  });
}
