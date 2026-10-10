import { useEffect, useState } from 'react';

import { Alert, Button, Card, Field, TextInput } from '../components/ui';
import { errorMessage } from '../lib/api-client';
import { useBranding, useUpdateBranding } from '../lib/queries';

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
            <TextInput required value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Короткое название" hint="Для шапки: «КС-54»">
            <TextInput value={shortName} onChange={(event) => setShortName(event.target.value)} />
          </Field>
          <Field label="Подпись" hint="Строка под названием на экране входа">
            <TextInput value={signature} onChange={(event) => setSignature(event.target.value)} />
          </Field>
          <Field label="Логотип" hint="PNG, JPEG или SVG до 256 КБ">
            <input
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              className="w-full text-sm"
              onChange={(event) => {
                const file = event.target.files?.[0];
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
  );
}
