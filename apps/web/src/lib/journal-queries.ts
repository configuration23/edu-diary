import type { QueryClient } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  attendanceEntrySchema,
  gradeEntrySchema,
  lessonJournalSchema,
  listGradeRevisionsResponseSchema,
  markAllPresentResponseSchema,
} from '@edu-diary/contracts';

import { apiRequest, apiSend } from './api-client';

/**
 * Журнал урока: отметки и посещаемость (Этап 4).
 *
 * Ключ запроса включает идентификатор урока: журнал открыт для одного урока, и
 * после изменения обновляем именно его, а не весь список уроков.
 */

/** Обновление журнала урока после изменения: список уроков тоже мог измениться. */
function invalidateJournal(client: QueryClient, lessonId: string): void {
  void client.invalidateQueries({ queryKey: ['journal', lessonId] });
  void client.invalidateQueries({ queryKey: ['lessons'] });
}

/** Экран урока: состав группы, отметки и правила накопления знаков. */
export function useLessonJournal(lessonId: string | null) {
  return useQuery({
    queryKey: ['journal', lessonId],
    enabled: lessonId !== null,
    queryFn: () => apiRequest(`/api/lessons/${String(lessonId)}/journal`, lessonJournalSchema),
  });
}

/** Оценка или знак за урок: повторная запись заменяет прежнюю отметку. */
export function useSaveGrade(lessonId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      studentId: string;
      value?: string | null;
      sign?: string | null;
      categoryId?: string | null;
      comment?: string | null;
    }) =>
      apiRequest(`/api/lessons/${lessonId}/grades`, gradeEntrySchema, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => invalidateJournal(client, lessonId),
  });
}

/** Посещаемость: статус и причина. */
export function useSaveAttendance(lessonId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { studentId: string; status: string; reason?: string | null }) =>
      apiRequest(`/api/lessons/${lessonId}/attendance`, attendanceEntrySchema, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => invalidateJournal(client, lessonId),
  });
}

/** «Отметить всех присутствующими»: одно действие на весь урок. */
export function useMarkAllPresent(lessonId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { exceptStudentIds?: string[] }) =>
      apiRequest(`/api/lessons/${lessonId}/attendance/all-present`, markAllPresentResponseSchema, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => invalidateJournal(client, lessonId),
  });
}

/** Правка оценки с обязательной причиной (ADR-011). */
export function useUpdateJournalGrade(lessonId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      gradeId: string;
      value?: string | null;
      sign?: string | null;
      comment?: string | null;
      reason: string;
    }) =>
      apiRequest(`/api/grades/${input.gradeId}`, gradeEntrySchema, {
        method: 'PATCH',
        body: {
          ...(input.value === undefined ? {} : { value: input.value }),
          ...(input.sign === undefined ? {} : { sign: input.sign }),
          ...(input.comment === undefined ? {} : { comment: input.comment }),
          reason: input.reason,
        },
      }),
    onSuccess: () => invalidateJournal(client, lessonId),
  });
}

/** Мягкое удаление оценки: причина обязательна. */
export function useDeleteJournalGrade(lessonId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { gradeId: string; reason: string }) =>
      apiSend(`/api/grades/${input.gradeId}`, {
        method: 'DELETE',
        body: { reason: input.reason },
      }),
    onSuccess: () => invalidateJournal(client, lessonId),
  });
}

/** История правок оценки: кто, когда, что было и что стало. */
export function useGradeRevisions(gradeId: string | null) {
  return useQuery({
    queryKey: ['grade-revisions', gradeId],
    enabled: gradeId !== null,
    queryFn: () =>
      apiRequest(`/api/grades/${String(gradeId)}/revisions`, listGradeRevisionsResponseSchema),
  });
}
