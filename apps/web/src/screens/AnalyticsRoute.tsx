import { useState } from 'react';

import type { SessionResponseDto } from '@edu-diary/contracts';

import { Field } from '../components/ui';
import { useJournalStats } from '../lib/journal-queries';
import { useAcademicYears, useGroups, usePeriods, useSubjects } from '../lib/queries';
import { AnalyticsScreen } from './AnalyticsScreen';

/**
 * Экран аналитики: отчёт по группе для администратора и преподавателя, «Мои оценки» для
 * ученика и законного представителя.
 *
 * Разница только в выборе группы: ученику она не нужна, сервер отдаёт его строки и без
 * неё. Всё остальное — период, предмет, таблица и диаграмма — общее.
 */
export function AnalyticsRoute({ session }: { session: SessionResponseDto }) {
  const canChooseGroup = session.permissions.some(
    (grant) =>
      grant.permission === 'analytics:read' &&
      (grant.scope === 'all' || grant.scope === 'assigned'),
  );

  const years = useAcademicYears();
  const activeYear = years.data?.items.find((year) => year.isActive) ?? years.data?.items[0];
  const periods = usePeriods();
  const groups = useGroups(activeYear === undefined ? {} : { academicYearId: activeYear.id });
  const subjects = useSubjects();

  /** Период по умолчанию — текущий учебный период: отчёт «за семестр» нужен чаще всего. */
  const currentPeriod =
    periods.data?.items.find(
      (period) =>
        period.startsOn <= new Date().toISOString().slice(0, 10) &&
        period.endsOn >= new Date().toISOString().slice(0, 10),
    ) ?? periods.data?.items[0];

  const [groupId, setGroupId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [from, setFrom] = useState(currentPeriod?.startsOn ?? '');
  const [to, setTo] = useState(currentPeriod?.endsOn ?? '');

  /**
   * Период приходит асинхронно: пока он не загружен, поля пусты, поэтому подставляем его
   * один раз, когда данные появились. Иначе отчёт открывался бы «за всё время».
   */
  const [periodApplied, setPeriodApplied] = useState(false);
  if (!periodApplied && currentPeriod !== undefined) {
    setPeriodApplied(true);
    if (from === '') setFrom(currentPeriod.startsOn);
    if (to === '') setTo(currentPeriod.endsOn);
  }

  /** Группа по умолчанию — первая доступная: чаще всего работают с одной. */
  if (canChooseGroup && groupId === '' && (groups.data?.items.length ?? 0) > 0) {
    setGroupId(groups.data?.items[0]?.id ?? '');
  }

  const stats = useJournalStats({
    ...(canChooseGroup && groupId !== '' ? { studyGroupId: groupId } : {}),
    ...(subjectId === '' ? {} : { subjectId }),
    ...(from === '' ? {} : { from }),
    ...(to === '' ? {} : { to }),
  });

  const groupPicker = canChooseGroup ? (
    <Field label="Группа">
      <select
        name="studyGroupId"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        value={groupId}
        onChange={(event) => setGroupId(event.target.value)}
      >
        <option value="">Выберите группу</option>
        {(groups.data?.items ?? []).map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </select>
    </Field>
  ) : undefined;

  return (
    <AnalyticsScreen
      items={stats.data?.items ?? []}
      from={from}
      to={to}
      subjectId={subjectId}
      subjects={subjects.data?.items ?? []}
      {...(groupPicker === undefined ? {} : { groupPicker })}
      onFromChange={setFrom}
      onToChange={setTo}
      onSubjectChange={setSubjectId}
      isLoading={stats.isLoading}
      error={stats.error}
    />
  );
}
