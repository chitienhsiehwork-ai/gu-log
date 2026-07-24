export type PostRepresentation = 'html' | 'markdown';

const MAX_ACCEPT_LENGTH = 8192;
const MAX_MEDIA_RANGES = 64;
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const Q_VALUE = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;
const CANONICAL_POST_PATH = /^\/(?:en\/)?posts\/[A-Za-z0-9][A-Za-z0-9-]*$/;

interface MediaRange {
  type: string;
  subtype: string;
  quality: number;
  specificity: number;
}

function parseMediaRange(value: string): MediaRange | null {
  const parts = value.split(';').map((part) => part.trim());
  if (parts.some((part) => part.length === 0)) return null;

  const mediaType = parts[0].split('/');
  if (mediaType.length !== 2) return null;
  const [rawType, rawSubtype] = mediaType;
  if (!TOKEN.test(rawType) || !TOKEN.test(rawSubtype)) return null;

  const type = rawType.toLowerCase();
  const subtype = rawSubtype.toLowerCase();
  if (type === '*' && subtype !== '*') return null;

  let quality = 1;
  let foundQuality = false;
  for (const parameter of parts.slice(1)) {
    const separator = parameter.indexOf('=');
    if (separator <= 0 || parameter.indexOf('=', separator + 1) !== -1) return null;
    const name = parameter.slice(0, separator).trim().toLowerCase();
    const parameterValue = parameter.slice(separator + 1).trim();
    if (name !== 'q' || foundQuality || !Q_VALUE.test(parameterValue)) return null;
    quality = Number(parameterValue);
    foundQuality = true;
  }

  return {
    type,
    subtype,
    quality,
    specificity: type === '*' ? 0 : subtype === '*' ? 1 : 2,
  };
}

function parseAccept(accept: string | null): MediaRange[] | null {
  if (accept === null || accept.trim().length === 0) return [];
  if (accept.length > MAX_ACCEPT_LENGTH || accept.includes('"')) return null;

  const values = accept.split(',');
  if (values.length > MAX_MEDIA_RANGES || values.some((value) => value.trim().length === 0)) {
    return null;
  }

  const ranges = values.map((value) => parseMediaRange(value.trim()));
  return ranges.every((range): range is MediaRange => range !== null) ? ranges : null;
}

function effectiveQuality(ranges: readonly MediaRange[], subtype: 'html' | 'markdown'): number {
  let specificity = -1;
  let quality = 0;
  for (const range of ranges) {
    const matches =
      (range.type === '*' && range.subtype === '*') ||
      (range.type === 'text' && (range.subtype === '*' || range.subtype === subtype));
    if (!matches) continue;
    if (range.specificity > specificity) {
      specificity = range.specificity;
      quality = range.quality;
    } else if (range.specificity === specificity) {
      quality = Math.max(quality, range.quality);
    }
  }
  return quality;
}

export function negotiatePostRepresentation(accept: string | null): PostRepresentation {
  const ranges = parseAccept(accept);
  if (ranges === null || ranges.length === 0) return 'html';

  const markdownQuality = effectiveQuality(ranges, 'markdown');
  const htmlQuality = effectiveQuality(ranges, 'html');
  return markdownQuality > 0 && markdownQuality > htmlQuality ? 'markdown' : 'html';
}

export function isCanonicalPostPath(pathname: string): boolean {
  return CANONICAL_POST_PATH.test(pathname);
}
