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
  };
}
