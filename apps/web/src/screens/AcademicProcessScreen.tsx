import type { SessionResponseDto } from '@edu-diary/contracts';

import { Page, PageHeader } from '../components/layout';
import { Spoiler } from '../components/Spoiler';
import { StudentsCard } from './StudentsCard';
import { AcademicsScreen } from './AcademicsScreen';
import { GroupsScreen } from './GroupsScreen';
import { AssignmentsScreen } from './AssignmentsScreen';

/**
 * «Учебный процесс» — три раздела одной страницей.
 *
 * Решение владельца: «Учебный год», «Группы и ученики» и «Назначения» объединены. Раньше это были
 * три пункта меню и три перехода, хотя работа идёт **сверху вниз по одной цепочке**: год → группы →
 * ученики → назначения. Каждый раздел — **спойлер** с описанием в одну-две строки, поэтому
 * страница открывается обзором, а не простынёй.
 *
 * Спойлеры по умолчанию **свёрнуты**: человек видит, из чего состоит учебный процесс, и раскрывает
 * нужное. Иначе объединение дало бы ту же простыню, от которой уходили.
 *
 * Почему не одним спойлером на раздел «Группы и ученики»: группы и ученики — **разные работы**
 * (состав группы против карточки человека), и в одном спойлере они снова читались бы как один
 * длинный блок. Поэтому четыре спойлера, а не три.
 */

/** Может ли человек заводить учеников: блок показываем только тем, кому это положено. */
function canManageStudents(session: SessionResponseDto): boolean {
  return session.permissions.some(
    (grant) => grant.permission === 'students:write' && grant.scope === 'all',
  );
}

export function AcademicProcessScreen({ session }: { session: SessionResponseDto }) {
  return (
    <Page>
      <PageHeader
        title="Учебный процесс"
        description="Год, группы, ученики и назначения — по порядку, сверху вниз. Раскройте нужный раздел."
      />

      <Spoiler
        title="Учебные годы"
        summary="Годы и периоды обучения, активный год. На активный год ориентируются группы и назначения."
      >
        <AcademicsScreen />
      </Spoiler>

      <Spoiler
        title="Группы"
        summary="Учебные группы активного года: состав, зачисление и отчисление, перевод между группами."
      >
        {/*
          Блок учеников внутри этого раздела не показываем: он вынесен отдельным спойлером.
          `canManageStudents={false}` выключает его в самом экране групп.
        */}
        <GroupsScreen canManageStudents={false} />
      </Spoiler>

      {canManageStudents(session) && (
        <Spoiler
          title="Ученики"
          summary="Карточки учеников: заведение, учётная запись при необходимости, привязка законных представителей."
        >
          <StudentsCard onNotice={() => {}} />
        </Spoiler>
      )}

      <Spoiler
        title="Назначения"
        summary="Кто ведёт предмет в группе и с какого по какое число. Урока без назначения не бывает."
      >
        <AssignmentsScreen session={session} />
      </Spoiler>
    </Page>
  );
}
