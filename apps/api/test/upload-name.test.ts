import { describe, expect, it } from 'vitest';

import { buildUploadName, safeExtension, slugifyNamePart } from '@edu-diary/domain';

/**
 * Имя файла строится сервером, а не приходит от клиента.
 *
 * Владелец: «дата_логинавтора_предмет.расширение», от исходного имени — только расширение.
 */
describe('имя загружаемого файла', () => {
  it('собирается из даты, логина и предмета', () => {
    const name = buildUploadName({
      at: new Date('2026-10-19T08:15:00Z'),
      login: 'uchenik-ivanov',
      subjectName: 'Математика',
      originalFileName: 'контрольная.docx',
    });

    expect(name).toBe('2026-10-19_uchenik-ivanov_matematika.docx');
  });

  it('без предмета подставляет понятную заглушку', () => {
    const name = buildUploadName({
      at: new Date('2026-10-19T08:15:00Z'),
      login: 'prepod-egorova',
      subjectName: null,
      originalFileName: 'scan.PDF',
    });

    expect(name).toBe('2026-10-19_prepod-egorova_bez-predmeta.pdf');
  });

  it('путь и спецсимволы в имени клиента не проходят', () => {
    const name = buildUploadName({
      at: new Date('2026-10-19T00:00:00Z'),
      login: '../admin',
      subjectName: '../../etc/passwd',
      originalFileName: '..%2f..%2fevil.png',
    });

    /** Точка в имени не остаётся никогда: иначе можно собрать путь. */
    expect(name).toBe('2026-10-19_admin_etc-passwd.png');
    expect(name).not.toContain('..');
    expect(name).not.toContain('/');
  });

  it('кириллица логина и предмета транслитерируется', () => {
    expect(slugifyNamePart('Ученик Иванов', 'avtor')).toBe('uchenik-ivanov');
    expect(slugifyNamePart('Информатика (Е2Е)', 'predmet')).toBe('informatika-e2e');
  });

  it('расширение проверяется: только буквы и цифры, не длиннее восьми', () => {
    expect(safeExtension('файл.tar.gz')).toBe('gz');
    expect(safeExtension('файл.оченьдлинноерасширение')).toBe('bin');
    expect(safeExtension('без-расширения')).toBe('bin');
    expect(safeExtension('файл.JPG')).toBe('jpg');
  });
});
