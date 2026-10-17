import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * «Отмена» в формах создания.
 *
 * Дефект, найденный владельцем: формы открываются кнопкой в шапке списка, но **закрыть их было
 * нечем** — только создать запись или перезагрузить страницу. Кнопка «Отмена» была лишь у формы
 * учебного года.
 *
 * Проверяем **исходник компонента**, а не отрендеренную страницу: формы по умолчанию скрыты, и в
 * разметке страницы их просто нет — проверка HTML их не увидит.
 */

/** Форма создания в файле: от объявления до закрывающей скобки компонента. */
function formBlock(file: string, name: string): string {
  const source = readFileSync(file, 'utf8');
  const start = source.indexOf(`function ${name}(`);

  expect(start, `не найдена форма ${name} в ${file}`).toBeGreaterThanOrEqual(0);

  /** Достаточно до следующего объявления функции: форма целиком внутри. */
  const next = source.indexOf('\\nfunction ', start + 1);
  const end = next === -1 ? source.length : next;

  return source.slice(start, end);
}

describe('формы создания закрываются кнопкой «Отмена»', () => {
  it('новая группа', () => {
    expect(formBlock('apps/web/src/screens/GroupsScreen.tsx', 'CreateGroupCard')).toContain(
      'Отмена',
    );
  });

  it('новый ученик', () => {
    expect(formBlock('apps/web/src/screens/StudentsCard.tsx', 'CreateStudentForm')).toContain(
      'Отмена',
    );
  });

  it('новое назначение', () => {
    expect(
      formBlock('apps/web/src/screens/AssignmentsScreen.tsx', 'CreateAssignmentCard'),
    ).toContain('Отмена');
  });

  it('новый учебный год', () => {
    expect(formBlock('apps/web/src/screens/AcademicsScreen.tsx', 'CreateYearCard')).toContain(
      'Отмена',
    );
  });
});
