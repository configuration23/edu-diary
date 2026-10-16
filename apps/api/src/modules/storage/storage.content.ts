/**
 * Определение типа файла по **содержимому** (`ARCHITECTURE.md` §7).
 *
 * Клиент сообщает и имя файла, и MIME — но верить им нельзя: под именем `смета.pdf` может
 * прийти что угодно, а расширение подделывается одной строкой. Поэтому тип определяем по
 * «магическим» байтам, а имя используем только для показа человеку.
 *
 * Запрещённые типы (HTML, SVG, скрипты) здесь не распознаются как документы и получают
 * `application/octet-stream`, а по расширению их отсекает домен — две независимые проверки.
 */

export interface DetectedType {
  mimeType: string;
  /** Короткое имя формата для журнала: `pdf`, `png`, `zip`. */
  format: string;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

/** Текстовые форматы проверяем по префиксу: так `zip` не спутать с `docx`. */
function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return Buffer.from(bytes.subarray(offset, offset + length)).toString('latin1');
}

/**
 * Формат по содержимому.
 *
 * Порядок проверок важен: контейнеры Office и ODF — это ZIP, поэтому сначала смотрим
 * сигнатуры более конкретных форматов, а ZIP проверяем последним.
 */
export function detectType(bytes: Uint8Array): DetectedType | null {
  if (bytes.length === 0) return null;

  // PDF.
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46]))
    return { mimeType: 'application/pdf', format: 'pdf' };

  // Картинки.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return { mimeType: 'image/png', format: 'png' };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mimeType: 'image/jpeg', format: 'jpeg' };
  if (ascii(bytes, 0, 3) === 'GIF') return { mimeType: 'image/gif', format: 'gif' };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return { mimeType: 'image/webp', format: 'webp' };
  }
  if (startsWith(bytes, [0x42, 0x4d])) return { mimeType: 'image/bmp', format: 'bmp' };

  // Архивы и контейнеры Office/ODF.
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    /** Внутри ZIP лежит `[Content_Types].xml` у Office и `mimetype` у ODF. */
    const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 4096))).toString('latin1');

    if (head.includes('word/'))
      return {
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        format: 'docx',
      };
    if (head.includes('xl/'))
      return {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        format: 'xlsx',
      };
    if (head.includes('ppt/'))
      return {
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        format: 'pptx',
      };
    if (head.includes('mimetypeapplication/vnd.oasis')) {
      return { mimeType: 'application/vnd.oasis.opendocument.text', format: 'odt' };
    }

    return { mimeType: 'application/zip', format: 'zip' };
  }

  // Старые форматы Office (OLE2): doc, xls, ppt одним контейнером.
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
    return { mimeType: 'application/x-ole-storage', format: 'ole' };
  }

  // RAR и 7z.
  if (
    startsWith(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]) &&
    (bytes[6] === 0x00 || bytes[6] === 0x01)
  ) {
    return { mimeType: 'application/vnd.rar', format: 'rar' };
  }
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf])) {
    return { mimeType: 'application/x-7z-compressed', format: '7z' };
  }

  /**
   * Текст: только печатаемые символы и переводы строк.
   *
   * Проверяем последним и осторожно: бинарный файл почти всегда содержит управляющие байты,
   * а ошибка здесь означала бы, что под видом текста приняли что-то другое.
   */
  if (isProbablyText(bytes)) {
    return { mimeType: 'text/plain', format: 'txt' };
  }

  return null;
}

function isProbablyText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 1024);

  for (const byte of sample) {
    const isPrintable = byte >= 0x20 && byte !== 0x7f;
    const isWhitespace = byte === 0x09 || byte === 0x0a || byte === 0x0d;
    /** UTF-8 многобайтовые символы: старший бит выставлен. */
    const isUtf8 = byte >= 0x80;

    if (!isPrintable && !isWhitespace && !isUtf8) return false;
  }

  return true;
}
