import type { QueryClient } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  applySignRulesResponseSchema,
  attendanceEntrySchema,
  gradeEntrySchema,
  lessonJournalSchema,
  listGradeCategoriesResponseSchema,
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

/**
 * Оценка или знак за урок.
 *
 * Отметок за урок может быть несколько, но причина обязательна. Если отметка с
 * такой же причиной уже есть, сервер отвечает конфликтом — интерфейс показывает
 * подтверждение и повторяет запрос с `replace`.
 */
export function useSaveGrade(lessonId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      studentId: string;
      value?: string | null;
      sign?: string | null;
      /** Причина обязательна: она объясняет оценку и задаёт вес в аналитике. */
      categoryId: string;
      comment?: string | null;
      /** Заменить отметку с той же причиной (подтверждение из интерфейса). */
      replace?: boolean;
    }) =>
      apiRequest(`/api/lessons/${lessonId}/grades`, gradeEntrySchema, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => invalidateJournal(client, lessonId),
  });
}

/** Посещаемость: буква журнала и признак «уважительная» с текстом причины. */
export function useSaveAttendance(lessonId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      studentId: string;
      status: string;
      /** Галочка «уважительная»: без неё причина не нужна. */
      isExcused?: boolean;
      reason?: string | null;
    }) =>
      apiRequest(`/api/lessons/${lessonId}/attendance`, attendanceEntrySchema, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => invalidateJournal(client, lessonId),
  });
}

/**
 * «Отметить всех присутствующими».
 *
 * Кнопки в интерфейсе нет: на практике отмечать приходится выборочно. Запрос
 * оставлен намеренно — вернём, если понадобится.
 */
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
      categoryId?: string;
      comment?: string | null;
      reason: string;
    }) =>
      apiRequest(`/api/grades/${input.gradeId}`, gradeEntrySchema, {
        method: 'PATCH',
        body: {
          ...(input.value === undefined ? {} : { value: input.value }),
          ...(input.sign === undefined ? {} : { sign: input.sign }),
          ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
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

/**
 * Справочник причин оценок: из него выбирается причина отметки.
 *
 * Причины «из коробки» создаются при старте приложения, поэтому список не бывает
 * пустым. Держим его в кэше подольше: справочник меняется редко, а открывают
 * журнал часто.
 */
export function useGradeCategoriesList() {
  return useQuery({
    queryKey: ['grade-categories'],
    queryFn: () => apiRequest('/api/grade-categories', listGradeCategoriesResponseSchema),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Пересчёт «плюсы и точки → оценка» за период группы.
 *
 * Запускается вручную: преподаватель должен понимать, откуда взялась оценка. После
 * пересчёта обновляем и журнал урока, и аналитику: оценки могли появиться у всех
 * учеников группы.
 */
export function useApplySignRules(lessonId: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { studyGroupId: string; from?: string; to?: string }) =>
      apiRequest('/api/journal/apply-sign-rules', applySignRulesResponseSchema, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      if (lessonId !== null) invalidateJournal(client, lessonId);
      void client.invalidateQueries({ queryKey: ['journal-stats'] });
    },
  });
}
