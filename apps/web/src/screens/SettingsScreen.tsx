import { MARKER_SYMBOLS, type MarkerEvent } from '@edu-diary/contracts';
import { useEffect, useState } from 'react';

import { Alert, Button, Card, Field, FilePicker, TextInput } from '../components/ui';
import { errorMessage } from '../lib/api-client';
import { useAppearance, useBranding, useUpdateAppearance, useUpdateBranding } from '../lib/queries';

/**
 * Настройки заведения: название, короткое имя, подпись и логотип.
 *
 * Эти значения показываются на экране входа и в шапке, поэтому после сохранения
 * обновляется состояние системы — шапка берёт брендинг оттуда.
 *
 * Логотип — только файл с диска: внешние ссылки запрещены (ADR-019), их
 * отвергает и сервер.
 */

const MAX_LOGO_BYTES = 256 * 1024;

const selectClass = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';

/**
 * Оформление уроков: чем обозначать события и использовать ли цвета предметов.
 *
 * Цвет в интерфейсе означает предмет, а события показываются значками. Значок
 * выбирается из набора: значение попадает в разметку, поэтому произвольная
 * строка недопустима. Настройку меняет только администратор.
 */
function AppearanceForm() {
  const appearance = useAppearance();
  const update = useUpdateAppearance();

  const [markersEnabled, setMarkersEnabled] = useState(true);
  const [colorsEnabled, setColorsEnabled] = useState(true);
  const [markers, setMarkers] = useState<Record<MarkerEvent, string>>({
    replaced: '🔄',
    cancelled: '❎',
  });
  const [saved, setSaved] = useState(false);

  // Поля заполняются текущими значениями один раз: иначе правки затирались бы
  // при каждом обновлении запроса.
  useEffect(() => {
    if (appearance.data === undefined) return;
    setMarkersEnabled(appearance.data.markersEnabled);
    setColorsEnabled(appearance.data.colorsEnabled);
    setMarkers(appearance.data.markers);
  }, [appearance.data]);

  const markerField = (event: MarkerEvent, label: string, hint: string) => (
    <Field label={label} hint={hint}>
      <select
        name={`marker-${event}`}
        className={selectClass}
        value={markers[event]}
        disabled={!markersEnabled}
        onChange={(changeEvent) =>
          setMarkers((current) => ({ ...current, [event]: changeEvent.target.value }))
        }
      >
        {MARKER_SYMBOLS.map((symbol) => (
          <option key={symbol} value={symbol}>
            {symbol}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <Card
      title="Оформление уроков"
      description="Цвет означает предмет, значки — события. Здесь выбирается, какими значками показывать замену и отмену."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaved(false);
          try {
            await update.mutateAsync({
              markersEnabled,
              colorsEnabled,
              markers: { replaced: markers.replaced, cancelled: markers.cancelled },
            });
            setSaved(true);
          } catch {
            // Ошибка показывается ниже.
          }
        }}
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="markersEnabled"
            checked={markersEnabled}
            onChange={(event) => setMarkersEnabled(event.target.checked)}
          />
          Показывать значки событий
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          {markerField('replaced', 'Значок замены', 'По умолчанию 🔄')}
          {markerField('cancelled', 'Значок отмены', 'По умолчанию ❎')}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="colorsEnabled"
            checked={colorsEnabled}
            onChange={(event) => setColorsEnabled(event.target.checked)}
          />
          Использовать цвета предметов
        </label>

        <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
          Пример: занятие по предмету с закреплённым цветом
          {markersEnabled && <span className="ml-1 text-base">{markers.replaced}</span>} — значок
          стоит в углу плитки, а цвет плитки показывает предмет.
        </div>

        {update.isError && <Alert tone="error">{errorMessage(update.error)}</Alert>}
        {saved && <Alert tone="success">Сохранено: расписание и уроки покажут новые значки.</Alert>}

        <div>
          <Button type="submit" disabled={update.isPending}>
            Сохранить оформление
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function SettingsScreen() {
  const branding = useBranding();
  const update = useUpdateBranding();

  const [title, setTitle] = useState('');
  const [shortName, setShortName] = useState('');
  const [signature, setSignature] = useState('');
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Поля заполняются текущими значениями один раз, когда они загрузились:
  // иначе правки затирались бы при каждом обновлении запроса.
  useEffect(() => {
    if (branding.data === undefined) return;
    setTitle(branding.data.title ?? '');
    setShortName(branding.data.shortName ?? '');
    setSignature(branding.data.signature ?? '');
    setLogoDataUrl(branding.data.logoDataUrl ?? null);
  }, [branding.data]);

  const readLogo = (file: File): void => {
    setLogoError(null);

    if (file.size > MAX_LOGO_BYTES) {
      setLogoError('Файл больше 256 КБ — выберите изображение меньше.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') setLogoDataUrl(result);
    };
    reader.onerror = () => setLogoError('Не удалось прочитать файл.');
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Настройки заведения"
        description="Название и логотип показываются на экране входа и в шапке дневника."
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setSaved(false);
            try {
              await update.mutateAsync({
                title: title === '' ? null : title,
                shortName: shortName === '' ? null : shortName,
                signature: signature === '' ? null : signature,
                logoDataUrl,
              });
              setSaved(true);
            } catch {
              // Ошибка показывается ниже.
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Название учебного заведения">
              <TextInput
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field label="Короткое название" hint="Для шапки: «КС-54»">
              <TextInput value={shortName} onChange={(event) => setShortName(event.target.value)} />
            </Field>
            <Field label="Подпись" hint="Строка под названием на экране входа">
              <TextInput value={signature} onChange={(event) => setSignature(event.target.value)} />
            </Field>
            <Field label="Логотип" hint="PNG, JPEG или SVG до 256 КБ">
              <FilePicker
                accept="image/png,image/jpeg,image/svg+xml"
                name="logo"
                onSelect={(file) => {
                  if (file !== undefined) readLogo(file);
                }}
              />
            </Field>
          </div>

          {logoError !== null && <Alert tone="warning">{logoError}</Alert>}
          {logoDataUrl !== null && (
            <div className="flex items-center gap-3">
              <img src={logoDataUrl} alt="Логотип" className="h-12 w-12 object-contain" />
              <Button tone="ghost" onClick={() => setLogoDataUrl(null)}>
                Убрать логотип
              </Button>
            </div>
          )}

          {update.isError && <Alert tone="error">{errorMessage(update.error)}</Alert>}
          {saved && (
            <Alert tone="success">Сохранено: шапка и экран входа покажут новые значения.</Alert>
          )}

          <div>
            <Button type="submit" disabled={update.isPending}>
              Сохранить
            </Button>
          </div>
        </form>
      </Card>

      <AppearanceForm />
    </div>
  );
}
