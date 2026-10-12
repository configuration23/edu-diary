import type { AppearanceDto, LessonDto } from '@edu-diary/contracts';

/**
 * Оформление урока: значок события и цвет предмета.
 *
 * Правило системы: **цвет означает предмет, а события показываются значками**.
 * Так интерфейс перестаёт быть пёстрым — одно средство несёт один смысл.
 *
 * Значки и включение цветов приходят из настроек (`appearance`), значения по
 * умолчанию — из контрактов. Перенос значком не обозначаем: урок просто
 * переезжает на другое время, отдельного состояния у него нет.
 */

/** Двенадцать оттенков по кругу: соседние цвета не совпадают. */
export const SUBJECT_COLOR_PALETTE = [
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ef4444',
  '#14b8a6',
  '#ec4899',
  '#84cc16',
  '#6366f1',
  '#f97316',
  '#06b6d4',
  '#a855f7',
];

const PALETTE = SUBJECT_COLOR_PALETTE;

/**
 * Цвет предмета: сначала закреплённый в справочнике, иначе — по кругу оттенков.
 *
 * Порядок фиксирован идентификатором предмета, поэтому один предмет всегда одного
 * цвета, а соседние в справочнике получают разные оттенки.
 */
export function subjectColor(subjectId: string, preferred?: string | null): string {
  if (preferred !== null && preferred !== undefined && preferred !== '') return preferred;

  let hash = 0;
  for (const char of subjectId) hash = (hash + char.charCodeAt(0)) % PALETTE.length;
  return PALETTE[hash] ?? PALETTE[0]!;
}

/** Значок события для урока: замена и отмена. Перенос не обозначаем. */
export function lessonMarker(
  lesson: Pick<LessonDto, 'status'>,
  appearance: AppearanceDto,
): string | null {
  if (!appearance.markersEnabled) return null;
  if (lesson.status === 'replaced') return appearance.markers.replaced;
  if (lesson.status === 'cancelled') return appearance.markers.cancelled;
  return null;
}

/** Цветной маркер предмета для строк и больших форм. */
export function SubjectDot({
  subjectId,
  color,
  enabled = true,
}: {
  subjectId: string;
  color?: string | null;
  enabled?: boolean;
}) {
  if (!enabled) return null;

  return (
    <span
      aria-hidden="true"
      className="mr-1 inline-block h-2.5 w-2.5 shrink-0 rounded-sm align-middle"
      style={{ backgroundColor: subjectColor(subjectId, color) }}
    />
  );
}
