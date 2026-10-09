import {
  consentSchema,
  healthResponseSchema,
  listAcademicYearsResponseSchema,
  listAuditResponseSchema,
  listConsentsResponseSchema,
  listPermissionsResponseSchema,
  listRolesResponseSchema,
  listSecurityEventsResponseSchema,
  listStudentsResponseSchema,
  listUsersResponseSchema,
  periodSchema,
  policyResponseSchema,
  sessionResponseSchema,
  setupStatusResponseSchema,
  studentSummarySchema,
  studentsWithoutConsentResponseSchema,
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
  periods: ['periods'] as const,
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
    queryKey: queryKeys.periods,
    queryFn: () => apiRequest('/api/periods', z.object({ items: z.array(periodSchema) })),
  });
}
