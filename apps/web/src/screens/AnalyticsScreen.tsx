import type { ReactNode } from 'react';

import type { JournalStatsResponseDto } from '@edu-diary/contracts';

import { Card, EmptyState, Field } from '../components/ui';

/**
 * Аналитика журнала (Этап 4, шаг 4).
 *
 * Один экран на две роли:
 * - администратор и преподаватель выбирают группу и видят строку на каждого ученика;
 * - ученик и законный представитель видят **свои** строки — сервер отдаёт только их, и
 *   группа тогда не нужна.
 *
 * Средний балл считается с весами причин, знаки «+» и «·» в него не входят: это не
 * оценки. Диаграмма — круговая на SVG: внешние библиотеки и CDN запрещены
 * (`SECURITY.md` §3.8), а ради одного круга тянуть зависимость незачем.
 */

const STATUS_LABELS: Record<string, string> = {
  present: 'Присутствовал',
  not_present: 'Не был',
  sick: 'Болел',
  late: 'Опоздал',
};

/**
 * Цвета секторов. Взяты из палитры Tailwind, чтобы диаграмма не спорила с интерфейсом.
 * «Присутствовал» — зелёный, отсутствие — красный, болезнь — янтарный, опоздание — синий.
 */
const STATUS_COLORS: Record<string, string> = {
  present: '#16a34a',
  not_present: '#dc2626',
  sick: '#f59e0b',
  late: '#2563eb',
};

/** Круговая диаграмма посещаемости: сектора считаются из процентов, отданных доменом. */
function AttendancePie({
  byStatus,
  total,
}: {
  byStatus: JournalStatsResponseDto['items'][number]['attendance']['byStatus'];
  total: number;
}) {
  if (total === 0) {
    return <EmptyState>Отмеченных занятий за период нет.</EmptyState>;
  }

  const segments = Object.entries(byStatus)
    .filter(([, value]) => value.count > 0)
    .map(([status, value]) => ({ status, ...value }));

  /**
   * Сектора рисуем дугами в одном круге: идём по накопленному углу и переводим проценты
   * в радианы. Радиус 40 при стороне 100 оставляет место под обводку.
   */
  let angle = 0;
  const arcs = segments.map((segment) => {
    const sweep = (segment.percent / 100) * 360;
    const start = (angle - 90) * (Math.PI / 180);
    const end = (angle + sweep - 90) * (Math.PI / 180);
    angle += sweep;

    const largeArc = sweep > 180 ? 1 : 0;
    const x1 = 50 + 40 * Math.cos(start);
    const y1 = 50 + 40 * Math.sin(start);
    const x2 = 50 + 40 * Math.cos(end);
    const y2 = 50 + 40 * Math.sin(end);

    return {
      status: segment.status,
      path: `M 50 50 L ${x1.toFixed(2)} ${y1.toFixed(2)} A 40 40 0 ${String(largeArc)} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`,
    };
  });

  // Один статус на все отметки: дуга в 360° вырождается, поэтому рисуем круг.
  const single = segments.length === 1;

  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox="0 0 100 100" className="h-32 w-32" role="img" aria-label="Посещаемость">
        {single ? (
          <circle
            cx="50"
            cy="50"
            r="40"
            fill={STATUS_COLORS[segments[0]?.status ?? 'present'] ?? '#94a3b8'}
          />
        ) : (
          arcs.map((arc) => (
            <path
              key={arc.status}
              d={arc.path}
              fill={STATUS_COLORS[arc.status] ?? '#94a3b8'}
              stroke="#ffffff"
              strokeWidth="1"
            />
          ))
        )}
      </svg>

      <ul className="space-y-1 text-sm">
        {segments.map((segment) => (
          <li key={segment.status} className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: STATUS_COLORS[segment.status] ?? '#94a3b8' }}
            />
            <span className="text-slate-700">
              {STATUS_LABELS[segment.status] ?? segment.status}
            </span>
            <span className="text-slate-500">
              {segment.count} ({Math.round(segment.percent)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AnalyticsScreen({
  items,
  from,
  to,
  subjectId,
  subjects,
  groupPicker,
  onFromChange,
  onToChange,
  onSubjectChange,
  isLoading,
  error,
}: {
  items: JournalStatsResponseDto['items'];
  from: string;
  to: string;
  subjectId: string;
  subjects: { id: string; name: string }[];
  /** Выбор группы: есть у администратора и преподавателя, ученику не нужен. */
  groupPicker?: ReactNode;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onSubjectChange: (value: string) => void;
  isLoading: boolean;
  error: unknown;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-lg font-medium text-slate-900">Аналитика</h2>
        <p className="mt-1 text-sm text-slate-600">
          Средний балл считается с весами причин: оценка умножается на вес причины, суммы делятся на
          общий вес. Знаки «+» и «·» в средний балл не входят — это не оценки.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {groupPicker !== undefined && <div>{groupPicker}</div>}

          <Field label="С даты">
            <input
              type="date"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={from}
              onChange={(event) => onFromChange(event.target.value)}
            />
          </Field>
          <Field label="По дату">
            <input
              type="date"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={to}
              onChange={(event) => onToChange(event.target.value)}
            />
          </Field>
          <Field label="Предмет">
            <select
              name="subjectId"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={subjectId}
              onChange={(event) => onSubjectChange(event.target.value)}
            >
              <option value="">Все предметы</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      {error !== null && error !== undefined && (
        <Card>
          <p className="text-sm text-red-700">Не удалось построить отчёт за выбранный период.</p>
        </Card>
      )}

      {isLoading && (
        <Card>
          <p className="text-sm text-slate-600">Загружаем…</p>
        </Card>
      )}

      {!isLoading && items.length === 0 && (
        <Card>
          <EmptyState>
            За выбранный период отметок нет. Измените период или выберите другой предмет.
          </EmptyState>
        </Card>
      )}

      {items.map((row) => (
        <Card key={row.studentId}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-medium text-slate-900">{row.studentName}</h3>
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="text-slate-700">
                Средний балл:{' '}
                <span className="font-medium">
                  {row.average === null ? '—' : row.average.toFixed(2)}
                </span>
              </span>
              <span className="text-slate-700">
                Оценок: <span className="font-medium">{row.gradesCount}</span>
              </span>
              <span className="text-slate-700">
                Посещаемость:{' '}
                <span className="font-medium">{Math.round(row.attendancePercent)}%</span>
              </span>
            </div>
          </div>

          <div className="mt-4">
            <AttendancePie byStatus={row.attendance.byStatus} total={row.attendance.total} />
          </div>
        </Card>
      ))}
    </div>
  );
}
