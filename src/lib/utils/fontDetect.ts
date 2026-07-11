// Curated list of font families that ship with one or more of:
// Windows (core + ClearType + Office), macOS, iOS, common Linux distros, MS Office.
// Detection filters this down to fonts actually installed on the current machine.
export const CANDIDATE_FONTS: readonly string[] = [
  // Web-safe / cross-platform staples
  'Arial', 'Arial Black', 'Arial Narrow', 'Arial Rounded MT Bold',
  'Courier New', 'Georgia', 'Helvetica', 'Helvetica Neue',
  'Impact', 'Lucida Console', 'Lucida Sans Unicode', 'Palatino',
  'Tahoma', 'Times', 'Times New Roman', 'Trebuchet MS', 'Verdana',

  // Windows core + ClearType
  'Calibri', 'Calibri Light', 'Cambria', 'Cambria Math',
  'Candara', 'Consolas', 'Constantia', 'Corbel',
  'Franklin Gothic Medium', 'Gabriola', 'Gadugi', 'Javanese Text',
  'Leelawadee UI', 'Lucida Sans', 'Malgun Gothic', 'Marlett',
  'Microsoft Himalaya', 'Microsoft JhengHei', 'Microsoft JhengHei UI',
  'Microsoft New Tai Lue', 'Microsoft PhagsPa', 'Microsoft Sans Serif',
  'Microsoft Tai Le', 'Microsoft YaHei', 'Microsoft YaHei UI',
  'Microsoft Yi Baiti', 'MingLiU-ExtB', 'Mongolian Baiti',
  'MS Gothic', 'MS Mincho', 'MS PGothic', 'MV Boli',
  'Myanmar Text', 'Nirmala UI', 'Palatino Linotype',
  'Segoe Print', 'Segoe Script', 'Segoe UI', 'Segoe UI Black',
  'Segoe UI Emoji', 'Segoe UI Historic', 'Segoe UI Light',
  'Segoe UI Semibold', 'Segoe UI Semilight', 'Segoe UI Symbol',
  'SimSun', 'Sitka', 'Sylfaen', 'Symbol', 'Webdings', 'Wingdings',
  'Yu Gothic', 'Yu Gothic UI', 'Yu Mincho',

  // MS Office bundled
  'Bahnschrift', 'Bookshelf Symbol 7', 'Ebrima', 'MS Reference Sans Serif',
  'MS Reference Specialty', 'Plantagenet Cherokee',

  // macOS system fonts
  'American Typewriter', 'Andale Mono', 'Apple Chancery', 'Apple Color Emoji',
  'Apple SD Gothic Neo', 'Apple Symbols', 'AppleGothic', 'AppleMyungjo',
  'Avenir', 'Avenir Next', 'Avenir Next Condensed', 'Baskerville',
  'Big Caslon', 'Bodoni 72', 'Bodoni 72 Oldstyle', 'Bodoni 72 Smallcaps',
  'Bradley Hand', 'Brush Script MT', 'Chalkboard', 'Chalkboard SE',
  'Chalkduster', 'Charter', 'Cochin', 'Comic Sans MS', 'Copperplate',
  'Courier', 'Damascus', 'Didot', 'Futura', 'Geneva', 'Gill Sans',
  'GungSeo', 'HeadLineA', 'Herculanum', 'Hiragino Maru Gothic Pro',
  'Hiragino Mincho ProN', 'Hiragino Sans', 'Hoefler Text', 'Iowan Old Style',
  'Kefa', 'Khmer Sangam MN', 'Kohinoor Bangla', 'Kohinoor Devanagari',
  'Kohinoor Telugu', 'Krungthep', 'Lao Sangam MN', 'Lucida Grande',
  'Luminari', 'Marker Felt', 'Menlo', 'Monaco', 'Mukta Mahee',
  'Nadeem', 'New Peninim MT', 'Noteworthy', 'Optima', 'Papyrus',
  'PingFang HK', 'PingFang SC', 'PingFang TC', 'PT Mono', 'PT Sans', 'PT Serif',
  'Rockwell', 'Savoye LET', 'SF Compact', 'SF Mono', 'SF Pro', 'SF Pro Display',
  'SF Pro Rounded', 'SF Pro Text', 'Sinhala Sangam MN', 'Skia',
  'Snell Roundhand', 'STIX Two Math', 'Superclarendon', 'Tamil Sangam MN',
  'Telugu Sangam MN', 'Thonburi', 'Trattatello', 'Zapf Dingbats', 'Zapfino',

  // Common Linux / open-source families
  'DejaVu Sans', 'DejaVu Sans Mono', 'DejaVu Serif',
  'Liberation Mono', 'Liberation Sans', 'Liberation Serif',
  'Linux Biolinum', 'Linux Libertine', 'Noto Sans', 'Noto Serif',
  'Noto Mono', 'Source Sans Pro', 'Source Serif Pro', 'Source Code Pro',
  'Ubuntu', 'Ubuntu Mono', 'Ubuntu Condensed',
  'Open Sans', 'Roboto', 'Roboto Condensed', 'Roboto Mono', 'Roboto Slab',
  'Lato', 'Inter', 'Fira Sans', 'Fira Code', 'Fira Mono',
  'Cantarell', 'FreeMono', 'FreeSans', 'FreeSerif',
] as const;

const PROBE_TEXT = 'mmmmmmmmmlli';
const PROBE_SIZE = '72px';
const BASELINES = ['monospace', 'sans-serif', 'serif'] as const;

let baselineWidths: number[] | null = null;
let detectionCtx: CanvasRenderingContext2D | null = null;

function getCtx(): CanvasRenderingContext2D | null {
  if (detectionCtx) return detectionCtx;
  try {
    const canvas = document.createElement('canvas');
    detectionCtx = canvas.getContext('2d');
    return detectionCtx;
  } catch {
    return null;
  }
}

function measure(ctx: CanvasRenderingContext2D, font: string): number {
  ctx.font = font;
  return ctx.measureText(PROBE_TEXT).width;
}

function isAvailable(ctx: CanvasRenderingContext2D, family: string): boolean {
  if (!baselineWidths) {
    baselineWidths = BASELINES.map((b) => measure(ctx, `${PROBE_SIZE} ${b}`));
  }
  const escaped = family.replace(/"/g, '\\"');
  for (let i = 0; i < BASELINES.length; i++) {
    const w = measure(ctx, `${PROBE_SIZE} "${escaped}", ${BASELINES[i]}`);
    if (w !== baselineWidths[i]) return true;
  }
  return false;
}

export function detectAvailableFonts(candidates: readonly string[]): string[] {
  const ctx = getCtx();
  if (!ctx) return [];
  baselineWidths = null;
  const found: string[] = [];
  for (const family of candidates) {
    if (isAvailable(ctx, family)) found.push(family);
  }
  return found;
}

// Families the app always renders via bundled @font-face twins, plus CSS generics —
// never flagged as missing. The bundled names must match the @font-face in global.css.
const BUNDLED_FONTS = ['Liberation Serif', 'Times New Roman', 'Calibri', 'Arial', 'Cambria', 'Courier New'];
const GENERIC_FAMILIES = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'];

// Of the given family names, those the browser can't render (so text declaring them is
// silently substituted). Bundled families and generics are excluded; result is deduped.
export async function unavailableFonts(families: Iterable<string>): Promise<string[]> {
  const ctx = getCtx();
  if (!ctx) return [];
  if (typeof document !== 'undefined' && document.fonts) {
    try {
      await Promise.all(BUNDLED_FONTS.map((f) => document.fonts.load(`12px "${f}"`)));
    } catch { /* measure with whatever loaded */ }
  }
  baselineWidths = null;
  const skip = new Set([...BUNDLED_FONTS, ...GENERIC_FAMILIES].map((f) => f.toLowerCase()));
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const raw of families) {
    const family = raw.trim();
    const key = family.toLowerCase();
    if (!family || seen.has(key) || skip.has(key)) continue;
    seen.add(key);
    if (!isAvailable(ctx, family)) missing.push(family);
  }
  return missing;
}

interface LocalFontData { family: string }
interface QueryLocalFontsWindow {
  queryLocalFonts?: () => Promise<LocalFontData[]>;
}

export function supportsLocalFontAccess(): boolean {
  return typeof (window as QueryLocalFontsWindow).queryLocalFonts === 'function';
}

export async function queryLocalFontsIfAllowed(): Promise<string[] | null> {
  const fn = (window as QueryLocalFontsWindow).queryLocalFonts;
  if (!fn) return null;
  try {
    const fonts = await fn();
    const families = new Set<string>();
    for (const f of fonts) families.add(f.family);
    return [...families].sort((a, b) => a.localeCompare(b));
  } catch {
    return null;
  }
}
