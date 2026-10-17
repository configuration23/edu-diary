import type { SessionResponseDto } from '@edu-diary/contracts';

import { Page, PageHeader } from '../components/layout';
import { Spoiler } from '../components/Spoiler';
import { StudentsCard } from './StudentsCard';
import { AcademicsScreen } from './AcademicsScreen';
import { GroupsScreen } from './GroupsScreen';
import { AssignmentsScreen } from './AssignmentsScreen';
import { ScheduleTemplateScreen } from './ScheduleTemplateScreen';
import { SubstitutionsScreen } from './SubstitutionsScreen';

/**
 * «Настройки обучения» — шесть разделов одной страницей.
 *
 * Решение владельца: «Учебный год», «Группы и ученики», «Назначения», «Сетка (шаблон)» и «Замены»
 * объединены. Раньше это были отдельные пункты меню и переходы между ними, хотя работа идёт
 * **сверху вниз по одной цепочке**: год → группы → ученики → назначения → шаблон недели → замены.
 * Каждый раздел — **спойлер** с описанием в одну-две строки, поэтому страница открывается обзором,
 * а не простынёй.
 *
 * Спойлеры по умолчанию **свёрнуты**: человек видит, из чего состоит обучение, и раскрывает нужное.
 * Иначе объединение дало бы ту же простыню, от которой уходили.
 *
 * Почему группа и ученики — **разные** спойлеры: это разные работы (состав группы против карточки
 * человека), и в одном спойлере они снова читались бы как один длинный блок.
 */

/** Может ли человек заводить учеников: блок показываем только тем, кому это положено. */
function canManageStudents(session: SessionResponseDto): boolean {
  return session.permissions.some(
    (grant) => grant.permission === 'students:write' && grant.scope === 'all',
  );
}

/** Может ли человек оформлять замены: право `substitutions:write` в объёме «все». */
function canManageSubstitutions(session: SessionResponseDto): boolean {
  return session.permissions.some(
    (grant) => grant.permission === 'substitutions:write' && grant.scope === 'all',
  );
}

export function AcademicProcessScreen({
  session,
  substitutionLessonId = null,
}: {
  session: SessionResponseDto;
  /**
   * Урок, выбранный по ссылке из раздела «Уроки».
   *
   * Раньше это был адрес `/substitutions?lessonId=…`. Теперь замены живут здесь, но ссылка должна
   * по-прежнему сразу открывать форму с заполненным занятием — поэтому параметр доезжает сюда.
   */
  substitutionLessonId?: string | null;
}) {
  return (
    <Page>
      <PageHeader
        title="Настройки обучения"
        description="Год, группы, ученики, назначения, шаблон недели и замены — по порядку, сверху вниз. Раскройте нужный раздел."
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

      {/*
        Шаблон недели и замены перенесены сюда из отдельных страниц «Сетка (шаблон)» и «Замены»
        (решение владельца). Обе — про то же самое расписание, что и назначения: назначение даёт
        уроку преподавателя, шаблон ставит урок в неделю, замена подменяет преподавателя на один
        урок. Держать их в отдельных пунктах меню значило разрывать одну цепочку.
      */}
      <Spoiler
        title="Шаблон недели"
        summary="Постоянное расписание на неделю: какой предмет, в какой день и на какой паре. Уроки по датам появляются в «Уроках»."
      >
        <ScheduleTemplateScreen session={session} />
      </Spoiler>

      <Spoiler
        title="Замены"
        summary="Кто кого заменяет и на какой срок. Замена оформляется на один урок и публикуется сразу."
        /**
         * Открываем сразу, если пришли по ссылке из «Уроков»: человек уже выбрал занятие и ждёт
         * форму, а не список свёрнутых разделов.
         */
        defaultOpen={substitutionLessonId !== null}
      >
        <SubstitutionsScreen
          groupId={null}
          canManage={canManageSubstitutions(session)}
          initialLessonId={substitutionLessonId}
        />
      </Spoiler>
    </Page>
  );
}
