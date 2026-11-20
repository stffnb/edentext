// The font picker's list: a few always-shown faces, the recently used ones, and
// whatever detection finds installed. Shared state, so every picker agrees.

import { detectInstalledFonts, queryLocalFontsIfAllowed, supportsLocalFontAccess } from '../../utils/fontDetect';
import { locale } from '../../i18n/i18n.svelte';

export const WEB_SAFE_FONTS: readonly string[] = [
  'Liberation Serif', 'Arial', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New',
];
const WEB_SAFE_SET = new Set<string>(WEB_SAFE_FONTS);

const RECENT_KEY = 'edentext-recent-fonts';
const MAX_RECENT = 5;

let recents = $state<string[]>(load());
let embedded = $state<string[]>([]);
let detected = $state<string[]>([]);
let allInstalled = $state<string[] | null>(null);
let detectionRan = false;

function load(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT);
  } catch { return []; }
}

export function recentFonts(): string[] {
  return recents;
}

export function noteFontUse(font: string): void {
  recents = [font, ...recents.filter((f) => f !== font)].slice(0, MAX_RECENT);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recents)); } catch { /* quota or disabled */ }
}

// The families the open document brought with it, registered via FontFace. Detection
// measures them as present, but they are in no candidate list, so they are named here.
export function noteEmbeddedFonts(families: string[]): void {
  embedded = [...new Set(families)];
}

// Everything installed that isn't already listed above, alphabetical.
export function otherFonts(): string[] {
  const recentSet = new Set(recents);
  return [...new Set([...embedded, ...(allInstalled ?? detected)])]
    .filter((f) => !WEB_SAFE_SET.has(f) && !recentSet.has(f))
    .sort((a, b) => a.localeCompare(b));
}

export function canListAllFonts(): boolean {
  return supportsLocalFontAccess() && allInstalled === null;
}

export async function ensureDetection(): Promise<void> {
  if (detectionRan) return;
  detectionRan = true;
  detected = await detectInstalledFonts();
}

// The Local Font Access API, which needs a user gesture and a permission grant.
export async function listAllFonts(): Promise<void> {
  const list = await queryLocalFontsIfAllowed();
  if (list && list.length > 0) allInstalled = list;
}

// A Chinese user looks for 宋体, a Japanese one for ＭＳ 明朝, a Korean one for 맑은 고딕, not
// the Latin name. Only the **label** changes: the run and the file keep the Latin family, which
// CSS and both formats resolve; Simplified and Traditional name the same faces differently.
type LabelLocale = 'zh-Hans' | 'zh-Hant' | 'ja' | 'ko';
const CJK_FONT_LABELS: Record<string, Partial<Record<LabelLocale, string>>> = {
  SimSun: { 'zh-Hans': '宋体', 'zh-Hant': '宋體' },
  NSimSun: { 'zh-Hans': '新宋体', 'zh-Hant': '新宋體' },
  SimHei: { 'zh-Hans': '黑体', 'zh-Hant': '黑體' },
  KaiTi: { 'zh-Hans': '楷体', 'zh-Hant': '楷體' },
  FangSong: { 'zh-Hans': '仿宋', 'zh-Hant': '仿宋' },
  DengXian: { 'zh-Hans': '等线', 'zh-Hant': '等線' },
  'DengXian Light': { 'zh-Hans': '等线 Light', 'zh-Hant': '等線 Light' },
  'Microsoft YaHei': { 'zh-Hans': '微软雅黑', 'zh-Hant': '微軟雅黑' },
  'Microsoft JhengHei': { 'zh-Hans': '微软正黑体', 'zh-Hant': '微軟正黑體' },
  PMingLiU: { 'zh-Hans': '新细明体', 'zh-Hant': '新細明體' },
  MingLiU: { 'zh-Hans': '细明体', 'zh-Hant': '細明體' },
  'DFKai-SB': { 'zh-Hans': '标楷体', 'zh-Hant': '標楷體' },
  'Heiti SC': { 'zh-Hans': '黑体-简', 'zh-Hant': '黑體-簡' },
  'Heiti TC': { 'zh-Hans': '黑体-繁', 'zh-Hant': '黑體-繁' },
  'Songti SC': { 'zh-Hans': '宋体-简', 'zh-Hant': '宋體-簡' },
  'Songti TC': { 'zh-Hans': '宋体-繁', 'zh-Hant': '宋體-繁' },
  'Kaiti SC': { 'zh-Hans': '楷体-简', 'zh-Hant': '楷體-簡' },
  'Kaiti TC': { 'zh-Hans': '楷体-繁', 'zh-Hant': '楷體-繁' },
  STSong: { 'zh-Hans': '华文宋体', 'zh-Hant': '華文宋體' },
  'Hiragino Sans GB': { 'zh-Hans': '冬青黑体简体中文', 'zh-Hant': '冬青黑體簡體中文' },
  'PingFang SC': { 'zh-Hans': '苹方-简', 'zh-Hant': '蘋方-簡' },
  'PingFang TC': { 'zh-Hans': '苹方-繁', 'zh-Hant': '蘋方-繁' },
  'PingFang HK': { 'zh-Hans': '苹方-港', 'zh-Hant': '蘋方-港' },
  'MS Mincho': { ja: 'ＭＳ 明朝' },
  'MS PMincho': { ja: 'ＭＳ Ｐ明朝' },
  'MS Gothic': { ja: 'ＭＳ ゴシック' },
  'MS PGothic': { ja: 'ＭＳ Ｐゴシック' },
  'Yu Mincho': { ja: '游明朝' },
  'Yu Gothic': { ja: '游ゴシック' },
  Meiryo: { ja: 'メイリオ' },
  'BIZ UDMincho': { ja: 'BIZ UD明朝' },
  'BIZ UDGothic': { ja: 'BIZ UDゴシック' },
  'Hiragino Mincho ProN': { ja: 'ヒラギノ明朝 ProN' },
  'Hiragino Sans': { ja: 'ヒラギノ角ゴシック' },
  'Hiragino Kaku Gothic ProN': { ja: 'ヒラギノ角ゴ ProN' },
  'Hiragino Maru Gothic Pro': { ja: 'ヒラギノ丸ゴ Pro' },
  'Malgun Gothic': { ko: '맑은 고딕' },
  Batang: { ko: '바탕' },
  Gulim: { ko: '굴림' },
  Dotum: { ko: '돋움' },
  Gungsuh: { ko: '궁서' },
  'Apple SD Gothic Neo': { ko: 'Apple SD 산돌고딕 Neo' },
  AppleGothic: { ko: '애플고딕' },
  AppleMyungjo: { ko: '애플명조' },
};

// Whether picking the font sets the asian half of the pair, as Word decides by the font's
// own script. Known faces, a name written in CJK, or a region tag (Noto Sans CJK SC,
// Source Han Serif JP). ponytail: a CJK face named otherwise lands in the western slot.
export function isAsianFont(family: string): boolean {
  return family in CJK_FONT_LABELS
    || /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}]|\b(CJK|SC|TC|HK|JP|KR)\b/u.test(family);
}

export function fontLabel(family: string): string {
  return CJK_FONT_LABELS[family]?.[locale() as LabelLocale] ?? family;
}

// The picker shows the label and takes it back, so a font found as 宋体 still resolves
// to the Latin family the run and the file carry.
export function fontMatches(family: string, typed: string): boolean {
  return family.toLowerCase().includes(typed) || fontLabel(family).toLowerCase().includes(typed);
}

export function fontFromLabel(typed: string, known: string[]): string | undefined {
  const want = typed.toLowerCase();
  const names = (f: string) => [f.toLowerCase(), fontLabel(f).toLowerCase()];
  return (
    known.find((f) => names(f).some((n) => n === want)) ??
    known.find((f) => names(f).some((n) => n.startsWith(want)))
  );
}
