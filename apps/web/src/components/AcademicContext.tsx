import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { SessionResponseDto } from '@edu-diary/contracts';

import { useAcademicYears, useAssignments, useGroups } from '../lib/queries';

/**
 * Контекст учебного процесса в шапке (ARCHITECTURE.md §4.1).
 *
 * Группа — это переключатель контекста, а не отдельный экран: выбранная группа
 * задаёт фильтр для разделов «Группы», «Назначения» и будущего журнала.
 *
 * Активный год один на систему, его выбирает администратор; преподаватель
 * видит только те группы, где у него есть назначения, — список приходит уже
 * ограниченным правами.
 */

export interface AcademicContextValue {
  activeYearTitle: string | null;
  groups: Array<{ id: string; name: string }>;
  /** Выбранная группа: `null` — «все доступные». */
  selectedGroupId: string | null;
  selectedGroupName: string | null;
  selectGroup: (id: string | null) => void;
}

const AcademicContext = createContext<AcademicContextValue>({
  activeYearTitle: null,
  groups: [],
  selectedGroupId: null,
  selectedGroupName: null,
  selectGroup: () => {},
});

export function useAcademicContext(): AcademicContextValue {
  return useContext(AcademicContext);
}

function buildValue(
  activeYearTitle: string | null,
  groups: Array<{ id: string; name: string }>,
  selectedGroupId: string | null,
  selectGroup: (id: string | null) => void,
): AcademicContextValue {
  return {
    activeYearTitle,
    groups,
    selectedGroupId,
    selectedGroupName: groups.find((group) => group.id === selectedGroupId)?.name ?? null,
    selectGroup,
  };
}

export function AcademicContextProvider({
  session,
  children,
}: {
  session: SessionResponseDto;
  children: ReactNode;
}) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const years = useAcademicYears();
  const activeYear = years.data?.items.find((year) => year.isActive) ?? null;

  const canSeeAllGroups = session.permissions.some(
    (grant) => grant.permission === 'academics:write' && grant.scope === 'all',
  );

  const allGroups = useGroups(
    canSeeAllGroups && activeYear !== null ? { academicYearId: activeYear.id } : {},
  );
  const mine = useAssignments();

  const groups = useMemo(() => {
    if (canSeeAllGroups) {
      return (allGroups.data?.items ?? []).map((group) => ({ id: group.id, name: group.name }));
    }

    // Преподавателю нужны только свои группы: их дают его назначения.
    const unique = new Map<string, string>();
    for (const assignment of mine.data?.items ?? []) {
      unique.set(assignment.studyGroupId, assignment.groupName);
    }
    return [...unique].map(([id, name]) => ({ id, name }));
  }, [canSeeAllGroups, allGroups.data, mine.data]);

  const selectGroup = useCallback((id: string | null) => setSelectedGroupId(id), []);

  const value = buildValue(activeYear?.title ?? null, groups, selectedGroupId, selectGroup);

  return <AcademicContext.Provider value={value}>{children}</AcademicContext.Provider>;
}

/** Переключатель группы для шапки: показывается, когда групп больше одной. */
export function GroupSwitcher() {
  const { groups, selectedGroupId, selectGroup, activeYearTitle } = useAcademicContext();

  if (groups.length === 0) {
    return (
      <span className="text-xs text-slate-500">
        {activeYearTitle === null ? 'Учебный год не выбран' : `Год ${activeYearTitle}`}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2 text-xs text-slate-600">
      {activeYearTitle !== null && <span className="text-slate-500">Год {activeYearTitle}</span>}
      <label className="flex items-center gap-1">
        <span className="text-slate-500">Группа</span>
        <select
          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          value={selectedGroupId ?? ''}
          onChange={(event) => selectGroup(event.target.value === '' ? null : event.target.value)}
        >
          <option value="">Все доступные</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      </label>
    </span>
  );
}
