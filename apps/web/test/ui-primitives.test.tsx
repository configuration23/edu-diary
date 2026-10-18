import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Field,
  FormActions,
  Link,
  Segmented,
  Select,
  Stack,
  Textarea,
  TextInput,
} from '../src/components/ui';

/**
 * Примитивы интерфейса.
 *
 * Проверяем **то, за что примитив отвечает**: ширину поля, роли токенов вместо оттенков палитры,
 * доступность переключателя. Разметку целиком не сверяем — она меняется при любой правке вида, и
 * такой тест пришлось бы переписывать вместе с ней.
 */

describe('поля формы', () => {
  it('поле ввода занимает всю ширину — иначе оно выглядит узкой колонкой', () => {
    /**
     * Владелец видел ровно это: `<textarea>` без `w-full` брал ширину по умолчанию. Проверка на
     * классе, потому что в jsdom ширины нет и «на глаз» это не поймать.
     */
    expect(renderToStaticMarkup(<TextInput />)).toContain('w-full');
    expect(renderToStaticMarkup(<Select />)).toContain('w-full');
    expect(renderToStaticMarkup(<Textarea />)).toContain('w-full');
  });

  it('список и многострочное поле рисуются примитивами, а не по месту', () => {
    const select = renderToStaticMarkup(
      <Select defaultValue="b">
        <option value="a">А</option>
        <option value="b">Б</option>
      </Select>,
    );

    expect(select).toContain('<select');
    expect(select).toContain('border-input');
    expect(renderToStaticMarkup(<Textarea defaultValue="текст" />)).toContain('<textarea');
  });

  it('флажок связан с подписью: нажимается вся строка', () => {
    const html = renderToStaticMarkup(<Checkbox label="только доступ" checked readOnly />);

    /** `<label>` вокруг ввода — это и есть «нажать на текст = переключить флажок». */
    expect(html).toMatch(/<label[^>]*>.*<input[^>]*type="checkbox"[^>]*>.*только доступ/s);
  });

  it('ошибка поля выводится цветом опасности, а не палитры', () => {
    const html = renderToStaticMarkup(
      <Field label="Название" error="Обязательное поле">
        <TextInput />
      </Field>,
    );

    expect(html).toContain('Обязательное поле');
    expect(html).toContain('text-danger-foreground');
  });
});

describe('кнопки и ссылки', () => {
  it('основная кнопка — на токене акцента, а не на оттенке палитры', () => {
    const html = renderToStaticMarkup(<Button>Сохранить</Button>);

    expect(html).toContain('bg-primary');
    expect(html).not.toContain('bg-blue-700');
  });

  it('у кнопки два размера: обычный и мелкий', () => {
    /** Три и больше — это снова разнобой, на который указывал владелец. */
    expect(renderToStaticMarkup(<Button>Обычная</Button>)).toContain('--control-height');
    expect(renderToStaticMarkup(<Button size="sm">Мелкая</Button>)).toContain(
      '--control-height-sm',
    );
  });

  it('ссылка — один вид на всё приложение', () => {
    const html = renderToStaticMarkup(<Link href="/x">Открыть</Link>);

    expect(html).toContain('text-primary');
    expect(html).toContain('underline');
  });
});

describe('действия формы', () => {
  it('«Отмена» входит в примитив: без неё форму нечем закрыть', () => {
    const html = renderToStaticMarkup(
      <FormActions submitLabel="Создать группу" onCancel={() => {}} />,
    );

    expect(html).toContain('Создать группу');
    expect(html).toContain('Отмена');
  });

  it('на время отправки подпись меняется и кнопка блокируется', () => {
    const html = renderToStaticMarkup(
      <FormActions submitLabel="Создать" pending onCancel={() => {}} />,
    );

    expect(html).toContain('Сохраняем…');
    expect(html).toContain('disabled');
  });

  it('без обработчика отмены кнопки нет', () => {
    const html = renderToStaticMarkup(<FormActions submitLabel="Создать" />);

    expect(html).not.toContain('Отмена');
  });
});

describe('переключатель вида', () => {
  it('выбранный вариант отмечен для чтения с экрана', () => {
    /**
     * Это не украшение: без `aria-pressed` человек со скринридером не узнает, какой вид включён.
     * Раньше переключатели были обычными кнопками и этого состояния не сообщали.
     */
    const html = renderToStaticMarkup(
      <Segmented
        label="Вид"
        value="week"
        onChange={() => {}}
        options={[
          { value: 'day', label: 'День' },
          { value: 'week', label: 'Неделя' },
        ]}
      />,
    );

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="Вид"');
  });

  it('выбранный вариант — акцент, невыбранный — приглушённый текст', () => {
    const html = renderToStaticMarkup(
      <Segmented
        label="Вид"
        value="day"
        onChange={() => {}}
        options={[{ value: 'day', label: 'День' }]}
      />,
    );

    expect(html).toContain('bg-primary');
    expect(html).not.toContain('bg-slate-900');
  });
});

describe('стек', () => {
  it('отступ выбирается по смыслу, а не числом', () => {
    expect(renderToStaticMarkup(<Stack gap="block">блок</Stack>)).toContain('gap-6');
    expect(renderToStaticMarkup(<Stack gap="field">поле</Stack>)).toContain('gap-3');
    expect(renderToStaticMarkup(<Stack gap="inline">строка</Stack>)).toContain('gap-1');
  });
});

describe('статусы в тёмной теме', () => {
  it('заливки статусов — токенами, чтобы темнеть вместе с темой', () => {
    /**
     * Светлый `amber-50` на тёмной странице стал бы ярким пятном. Токен `warning-soft` в тёмной теме
     * имеет своё значение — и проверка наборов токенов следит, чтобы оно было.
     */
    for (const html of [
      renderToStaticMarkup(<Alert tone="warning">Внимание</Alert>),
      renderToStaticMarkup(<Badge tone="warning">ожидание</Badge>),
    ]) {
      expect(html).toContain('warning-soft');
      expect(html).not.toContain('amber-');
    }
  });
});
