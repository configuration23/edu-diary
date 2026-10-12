import {
  academicYearSchema,
  bellScheduleSchema,
  generateLessonsResponseSchema,
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
  listGuardianLinksResponseSchema,
  listBellsResponseSchema,
  listGroupOptionsResponseSchema,
  listGroupsResponseSchema,
  listPermissionsResponseSchema,
  listRolesResponseSchema,
  listRoomsResponseSchema,
  listSecurityEventsResponseSchema,
  listStudentsResponseSchema,
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
  type LessonDto,
  type SessionResponseDto,
  type SetupStatusResponseDto,
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
    onSuccess: () => client.invalidateQueries(),
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

export function useStudents(params: { search?: string; limit?: number }) {
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

export function useAcademicYears() {
  return useQuery({
    queryKey: queryKeys.academicYears,
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

export function useGroups(params: { academicYearId?: string; search?: string } = {}) {
  const query = toQueryString(params);

  return useQuery({
    queryKey: queryKeys.groups(query),
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

export function useAssignments(params: { teacherUserId?: string; studyGroupId?: string } = {}) {
  const query = toQueryString(params);

  return useQuery({
    queryKey: queryKeys.assignments(query),
    queryFn: () => apiRequest(`/api/assignments${query}`, listAssignmentsResponseSchema),
  });
}

/**
 * Преподаватели для назначений: список пользователей с ролью `teacher`.
 *
 * Роль приходит в каждой записи, поэтому фильтруем на клиенте — отдельного
 * «списка преподавателей» API не заводит.
 */
export function useTeachers() {
  const query = toQueryString({ limit: 200 });

  return useQuery({
    queryKey: queryKeys.users(query),
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
    mutationFn: (input: { studyGroupId: string; from: string; to: string }) =>
      apiRequest('/api/lessons/generate', generateLessonsResponseSchema, {
        method: 'POST',
        body: input,
      }),
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
    }) => apiRequest('/api/settings/branding', brandingSchema, { method: 'PUT', body: input }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['branding'] });
      void client.invalidateQueries({ queryKey: ['setup'] });
    },
  });
}
