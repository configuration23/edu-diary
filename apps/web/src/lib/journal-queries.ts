import type { QueryClient } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  applySignRulesResponseSchema,
  attendanceEntrySchema,
  gradeEntrySchema,
  lessonJournalSchema,
  attendanceBySubjectResponseSchema,
  gradesBySubjectResponseSchema,
  journalStatsResponseSchema,
  marksByStudentResponseSchema,
  lessonMarksResponseSchema,
  listDeletedResponseSchema,
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
    onSuccess: () => {
      invalidateJournal(client, lessonId);
      /**
       * Список удалённого — отдельный запрос. Без его сброса удалённая отметка в
       * корзине не появлялась до обновления страницы: журнал обновлялся, а список
       * оставался прежним.
       */
      void client.invalidateQueries({ queryKey: ['journal-deleted', lessonId] });
    },
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

/**
 * Удалённые отметки урока: что убрали, кто и почему.
 *
 * Список нужен администратору: из журнала удалённое исчезает, и без него вернуть
 * отметку было бы нечем.
 */
export function useDeletedMarks(lessonId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['journal-deleted', lessonId],
    enabled: lessonId !== null && enabled,
    queryFn: () =>
      apiRequest(`/api/lessons/${String(lessonId)}/deleted`, listDeletedResponseSchema),
  });
}

/** Восстановление удалённой отметки: и оценки, и посещаемости. */
export function useRestoreMark(lessonId: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: 'grade' | 'attendance'; id: string }) =>
      apiSend(`/api/${input.kind === 'grade' ? 'grades' : 'attendance'}/${input.id}/restore`, {
        method: 'POST',
      }),
    onSuccess: () => {
      if (lessonId !== null) invalidateJournal(client, lessonId);
      // Список удалённого — отдельный запрос: без сброса он показывал бы уже
      // восстановленную отметку как удалённую.
      void client.invalidateQueries({ queryKey: ['journal-deleted', lessonId] });
    },
  });
}

/** Удаление отметки посещаемости: причина обязательна (ADR-011). */
export function useDeleteAttendance(lessonId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { attendanceId: string; reason: string }) =>
      apiSend(`/api/attendance/${input.attendanceId}`, {
        method: 'DELETE',
        body: { reason: input.reason },
      }),
    onSuccess: () => {
      invalidateJournal(client, lessonId);
      void client.invalidateQueries({ queryKey: ['journal-deleted', lessonId] });
    },
  });
}

/** История правок отметки посещаемости: кто, когда, было и стало. */
export function useAttendanceRevisions(attendanceId: string | null) {
  return useQuery({
    queryKey: ['attendance-revisions', attendanceId],
    enabled: attendanceId !== null,
    queryFn: () =>
      apiRequest(
        `/api/attendance/${String(attendanceId)}/revisions`,
        listGradeRevisionsResponseSchema,
      ),
  });
}

/**
 * Аналитика: средний балл и посещаемость (Этап 4, шаг 4).
 *
 * Отчёт строится по группе за период. Ученику и представителю группа не нужна: сервер
 * сам берёт только их строки, поэтому тот же запрос обслуживает и «Мои оценки».
 */
export function useJournalStats(filter: {
  studyGroupId?: string;
  subjectId?: string;
  from?: string;
  to?: string;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== '') params.set(key, value);
  }

  const query = params.toString();

  return useQuery({
    queryKey: ['journal-stats', query],
    /**
     * Без группы отчёт по группе бессмысленен, но ученику он нужен: сервер отдаёт его
     * строки и без группы. Поэтому запрос не выключаем, а решаем на экране.
     */
    queryFn: () =>
      apiRequest(
        `/api/journal/stats${query === '' ? '' : `?${query}`}`,
        journalStatsResponseSchema,
      ),
  });
}

/**
 * Отметки по списку занятий: расписанию нужны оценки и посещаемость за период.
 *
 * Один запрос на весь период вместо журнала по каждому уроку: неделя — это до тридцати
 * занятий, и столько запросов на экран означало бы и мигание, и лишнюю нагрузку.
 */
export function useLessonMarks(lessonIds: string[]) {
  const params = new URLSearchParams();
  for (const id of lessonIds) params.append('lessonIds', id);

  const query = params.toString();

  return useQuery({
    /** Ключ включает список занятий: меняется период — меняется выборка. */
    queryKey: ['lesson-marks', query],
    enabled: lessonIds.length > 0,
    queryFn: () => apiRequest(`/api/journal/lesson-marks?${query}`, lessonMarksResponseSchema),
  });
}

/** Общие галочки раздела «Оценки и посещение». */
export interface AbsenceOptions {
  countExcused: boolean;
  countSick: boolean;
}

/**
 * Отметки по предметам: раздел «Оценки и посещение» для ученика, представителя и
 * администратора, выбравшего ученика.
 *
 * Диапазон дат не передаём: раздел всегда работает за текущий учебный период.
 */
export function useGradesBySubject(studentId: string | null) {
  const query = studentId === null ? '' : `?studentId=${studentId}`;

  return useQuery({
    queryKey: ['grades-by-subject', query],
    queryFn: () =>
      apiRequest(`/api/journal/grades-by-subject${query}`, gradesBySubjectResponseSchema),
  });
}

export function useAttendanceBySubject(studentId: string | null, options: AbsenceOptions) {
  const params = new URLSearchParams();
  if (studentId !== null) params.set('studentId', studentId);
  if (options.countExcused) params.set('countExcused', 'true');
  if (options.countSick) params.set('countSick', 'true');

  const query = params.toString();

  return useQuery({
    /** Ключ включает галочки: смена галочки меняет расчёт, и ответ нужно обновить. */
    queryKey: ['attendance-by-subject', query],
    queryFn: () =>
      apiRequest(
        `/api/journal/attendance-by-subject${query === '' ? '' : `?${query}`}`,
        attendanceBySubjectResponseSchema,
      ),
  });
}

/** Вид преподавателя: строки по ученикам его группы за текущий период. */
export function useMarksByStudent(
  filter: { studyGroupId: string; subjectId: string },
  options: AbsenceOptions,
  enabled: boolean,
) {
  const params = new URLSearchParams();
  params.set('studyGroupId', filter.studyGroupId);
  params.set('subjectId', filter.subjectId);
  if (options.countExcused) params.set('countExcused', 'true');
  if (options.countSick) params.set('countSick', 'true');

  const query = params.toString();

  return useQuery({
    queryKey: ['marks-by-student', query],
    enabled: enabled && filter.studyGroupId !== '' && filter.subjectId !== '',
    queryFn: () =>
      apiRequest(`/api/journal/marks-by-student?${query}`, marksByStudentResponseSchema),
  });
}
