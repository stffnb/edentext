import type { Editor } from '@tiptap/core';
import type { Mark } from '@tiptap/pm/model';

type MarkInfo = { type: string; attrs: Record<string, unknown> };

export type ColorDebugSnapshot = {
  timestamp: string;
  theme: {
    dataTheme: string | null;
  };
  selection: {
    from: number;
    to: number;
    empty: boolean;
    storedMarks: MarkInfo[] | null;
    headMarks: MarkInfo[];
    marksBefore: MarkInfo[];
    marksAfter: MarkInfo[];
  };
  textRuns: Array<{
    from: number;
    to: number;
    text: string;
    color: string | null;
    fontFamily: string | null;
    fontSize: string | null;
  }>;
  documentColors: Record<string, { count: number; totalChars: number; sample: string }>;
  domSpans: {
    total: number;
    sample: Array<{ dataColor: string | null; inlineStyle: string | null; text: string }>;
  };
  /** What the browser paints — the marks above only say what it was asked to. */
  painted: {
    /** The custom properties a run of no colour of its own resolves through. */
    vars: Record<string, string>;
    /** One entry per colour actually rendered, with where that colour comes from. */
    colors: Record<string, { chars: number; sample: string; block: string; source: PaintSource | null }>;
    /** The colour-carrying rules of the document stylesheet (styles/styleSheet.ts). */
    styleRules: string[];
  };
};

/** The nearest element declaring a colour, i.e. the channel a painted colour arrives on. */
type PaintSource = {
  tag: string;
  className: string;
  dataColor: string | null;
  inlineColor: string | null;
};

const TEXT_PREVIEW_LIMIT = 80;
const DOM_SAMPLE_LIMIT = 20;

function truncate(text: string, limit: number = TEXT_PREVIEW_LIMIT): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + '…';
}

function serializeMark(mark: Mark): MarkInfo {
  return { type: mark.type.name, attrs: { ...mark.attrs } };
}

function serializeMarks(marks: readonly Mark[] | null | undefined): MarkInfo[] {
  if (!marks) return [];
  return marks.map(serializeMark);
}

function getTextStyleAttr(marks: readonly Mark[], attr: string): string | null {
  const m = marks.find((mk) => mk.type.name === 'textStyle');
  const v = m?.attrs?.[attr];
  return typeof v === 'string' && v ? v : null;
}

const PAINT_VARS = ['--color-page-text', '--color-page-bg', '--color-text', '--font-color'];
const INLINE_COLOR = /(?:^|;)\s*color\s*:\s*([^;]+)/;
const STYLE_RULE_LIMIT = 40;

// Walking up to the editor root: the first element declaring a colour is the channel the
// run is painted through. None of them = the page's own colour (editor.css).
function paintSource(from: HTMLElement, root: HTMLElement): PaintSource | null {
  for (let e: HTMLElement | null = from; e; e = e.parentElement) {
    const inline = INLINE_COLOR.exec(e.getAttribute('style') ?? '');
    if (inline || e.hasAttribute('data-color')) {
      return {
        tag: e.tagName.toLowerCase(),
        className: e.getAttribute('class') ?? '',
        dataColor: e.getAttribute('data-color'),
        inlineColor: inline ? inline[1].trim() : null,
      };
    }
    if (e === root) break;
  }
  return null;
}

// The block a run sits in, named as the CSS would address it: its tag and the named
// paragraph style whose rule reaches it.
function blockOf(from: HTMLElement, root: HTMLElement): string {
  const block = from.closest('p, h1, h2, h3, h4, h5, h6, h7, h8, h9, h10, li, td, th') ?? from;
  const styled = from.closest('[data-style]');
  const name = styled && root.contains(styled) ? styled.getAttribute('data-style') : null;
  return name ? `${block.tagName.toLowerCase()}[${name}]` : block.tagName.toLowerCase();
}

function paintedColors(root: HTMLElement): ColorDebugSnapshot['painted']['colors'] {
  const out: ColorDebugSnapshot['painted']['colors'] = {};
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return out;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent ?? '';
    const el = n.parentElement;
    if (!text.trim() || !el) continue;
    const color = getComputedStyle(el).color;
    if (!out[color]) {
      out[color] = { chars: 0, sample: truncate(text.trim(), 40), block: blockOf(el, root), source: paintSource(el, root) };
    }
    out[color].chars += text.length;
  }
  return out;
}

function documentStyleColorRules(): string[] {
  const sheet = (document.getElementById('document-styles') as HTMLStyleElement | null)?.sheet;
  if (!sheet) return [];
  try {
    return Array.from(sheet.cssRules)
      .map((r) => r.cssText)
      .filter((t) => INLINE_COLOR.test(t) || t.includes('{color:') || t.includes(' color:'))
      .slice(0, STYLE_RULE_LIMIT);
  } catch {
    return [];
  }
}

export function getColorDebug(editor: Editor): ColorDebugSnapshot {
  const { state } = editor;
  const { doc, selection, storedMarks } = state;
  const { from, to, empty } = selection;

  const resolvedFrom = doc.resolve(from);
  const resolvedTo = doc.resolve(to);
  const marksBefore = serializeMarks(resolvedFrom.nodeBefore?.marks);
  const marksAfter = serializeMarks(resolvedTo.nodeAfter?.marks);

  const textRuns: ColorDebugSnapshot['textRuns'] = [];
  const documentColors: ColorDebugSnapshot['documentColors'] = {};

  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text ?? '';
    const color = getTextStyleAttr(node.marks, 'color');
    const fontFamily = getTextStyleAttr(node.marks, 'fontFamily');
    const fontSize = getTextStyleAttr(node.marks, 'fontSize');
    const runFrom = pos;
    const runTo = pos + node.nodeSize;

    textRuns.push({
      from: runFrom,
      to: runTo,
      text: truncate(text),
      color,
      fontFamily,
      fontSize,
    });

    const key = color ?? '(none)';
    if (!documentColors[key]) {
      documentColors[key] = { count: 0, totalChars: 0, sample: truncate(text, 40) };
    }
    documentColors[key].count += 1;
    documentColors[key].totalChars += text.length;
  });

  const domSpansSample: ColorDebugSnapshot['domSpans']['sample'] = [];
  let domSpansTotal = 0;
  const root = editor.view.dom;
  if (root && typeof root.querySelectorAll === 'function') {
    const spans = root.querySelectorAll('[data-color]');
    domSpansTotal = spans.length;
    for (let i = 0; i < Math.min(spans.length, DOM_SAMPLE_LIMIT); i++) {
      const el = spans[i] as HTMLElement;
      domSpansSample.push({
        dataColor: el.getAttribute('data-color'),
        inlineStyle: el.getAttribute('style'),
        text: truncate(el.textContent ?? ''),
      });
    }
  }

  const dataTheme =
    typeof document !== 'undefined'
      ? document.documentElement.getAttribute('data-theme')
      : null;

  // Read on the editor's own element: a page decoration or a theme override lands
  // between :root and the text, and only this end of the cascade shows it.
  const paintVars: Record<string, string> = {};
  if (root && typeof getComputedStyle === 'function') {
    const cs = getComputedStyle(root as HTMLElement);
    for (const v of PAINT_VARS) paintVars[v] = cs.getPropertyValue(v).trim();
    paintVars.color = cs.color;
  }

  return {
    timestamp: new Date().toISOString(),
    theme: { dataTheme },
    selection: {
      from,
      to,
      empty,
      storedMarks: storedMarks ? serializeMarks(storedMarks) : null,
      headMarks: serializeMarks(selection.$head.marks()),
      marksBefore,
      marksAfter,
    },
    textRuns,
    documentColors,
    domSpans: {
      total: domSpansTotal,
      sample: domSpansSample,
    },
    painted: {
      vars: paintVars,
      colors: root ? paintedColors(root as HTMLElement) : {},
      styleRules: typeof document !== 'undefined' ? documentStyleColorRules() : [],
    },
  };
}
