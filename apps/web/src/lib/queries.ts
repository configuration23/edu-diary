import {
  academicYearSchema,
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
  listGroupsResponseSchema,
  listPermissionsResponseSchema,
  listRolesResponseSchema,
  listRoomsResponseSchema,
  listSecurityEventsResponseSchema,
  listStudentsResponseSchema,
  listSubjectsResponseSchema,
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
  userSummarySchema,
  type SessionResponseDto,
  type SetupStatusResponseDto,
} from '@edu-diary/contracts';
import {
  useMutation,
  useQuery,
  useQueryClient,
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
    mutationFn: (input: unknown) =>
      apiRequest('/api/users', userSummarySchema, { method: 'POST', body: input }),
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
    mutationFn: (input: { fullName: string; userId?: string | null }) =>
      apiRequest('/api/students', studentSummarySchema, { method: 'POST', body: input }),
    onSuccess: () => invalidateStudents(client),
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
    onSuccess: () => invalidateStudents(client),
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
    mutationFn: (input: { id: string; title: string }) =>
      apiRequest(`/api/academic-years/${input.id}`, academicYearSchema, {
        method: 'PATCH',
        body: { title: input.title },
      }),
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
    mutationFn: (input: { groupId: string; studentId: string; joinedOn: string }) =>
      apiRequest(`/api/groups/${input.groupId}/enrollments`, enrollStudentResponseSchema, {
        method: 'POST',
        body: { studentId: input.studentId, joinedOn: input.joinedOn },
      }),
    onSuccess: () => invalidateAcademics(client),
  });
}

export function useWithdrawStudent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { enrollmentId: string; leftOn: string }) =>
      apiRequest(`/api/enrollments/${input.enrollmentId}`, enrollmentSchema, {
        method: 'PATCH',
        body: { leftOn: input.leftOn },
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
