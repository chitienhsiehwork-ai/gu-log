export type PostRepresentation = 'html' | 'markdown';

const CANONICAL_POST_PATH = /^\/(?:en\/)?posts\/[A-Za-z0-9][A-Za-z0-9-]*\/?$/;

interface MediaRange {
  type: string;
  subtype: string;
  quality: number;
  specificity: number;
}

// Lenient by design: ignore parameters other than q and skip ranges we can't read,
// so `text/markdown;charset=utf-8` still asks for Markdown.
function parseAccept(accept: string | null): MediaRange[] {
  if (!accept) return [];
  return accept.split(',').flatMap((value) => {
    const [mediaType, ...parameters] = value.split(';');
    const [type, subtype] = mediaType.trim().toLowerCase().split('/');
    if (!type || !subtype) return [];
    const q = parameters.map((p) => p.trim().toLowerCase()).find((p) => p.startsWith('q='));
    const quality = q === undefined ? 1 : Number(q.slice(2));
    if (!(quality >= 0 && quality <= 1)) return [];
    return [{ type, subtype, quality, specificity: type === '*' ? 0 : subtype === '*' ? 1 : 2 }];
  });
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
  if (ranges.length === 0) return 'html';

  const markdownQuality = effectiveQuality(ranges, 'markdown');
  const htmlQuality = effectiveQuality(ranges, 'html');
  return markdownQuality > 0 && markdownQuality > htmlQuality ? 'markdown' : 'html';
}

export function isCanonicalPostPath(pathname: string): boolean {
  return CANONICAL_POST_PATH.test(pathname);
}
