import type { BellScheduleDto } from '@edu-diary/contracts';

/**
 * Номера пар, которые показываем в сетках.
 *
 * Источник истины — справочник «Звонки»: если в заведении четыре пары, показывать
 * восемь незачем. Пары без звонков всё равно нельзя заполнить, а лишние строки
 * только удлиняют сетку.
 *
 * Если звонков нет вообще (свежая база), показываем одну пару: пустая сетка без
 * единой строки выглядит поломанной, а подсказка рядом объясняет, что заполнить
 * «Звонки» нужно в справочнике.
 */
export function pairsFromBells(bells: BellScheduleDto[] | undefined): number[] {
  if (bells === undefined) return [1, 2, 3, 4, 5, 6, 7, 8];

  const numbers = [...new Set(bells.map((bell) => bell.pairNumber))].sort((a, b) => a - b);
  return numbers.length === 0 ? [1] : numbers;
}

/** Звонки заведены: сетка опирается на них, а не на «первые восемь пар». */
export function hasBells(bells: BellScheduleDto[] | undefined): boolean {
  return bells !== undefined && bells.length > 0;
}
