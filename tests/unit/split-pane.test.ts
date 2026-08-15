// The split view's second pane renders the first pane's pagination. Every layout pass
// asks isSplitPane which view it is looking at, so the marker has to survive the real
// nesting (.editor > .paper-scaler > .paper > .tiptap-host > .tiptap).
import { describe, it, expect } from 'vitest';
import type { EditorView } from '@tiptap/pm/view';
import { isSplitPane } from '../../src/lib/editor/extensions/pageBreaks';

function pane(split: boolean): EditorView {
  const scroller = document.createElement('div');
  scroller.className = 'editor';
  const paper = document.createElement('div');
  paper.className = 'paper';
  const host = document.createElement('div');
  host.className = 'tiptap-host';
  if (split) host.setAttribute('data-split-pane', '');
  const dom = document.createElement('div');
  dom.className = 'tiptap';
  host.appendChild(dom);
  paper.appendChild(host);
  scroller.appendChild(paper);
  return { dom } as unknown as EditorView;
}

describe('isSplitPane', () => {
  it('is false for the editor’s own view', () => {
    expect(isSplitPane(pane(false))).toBe(false);
  });

  it('is true through the paper the second view mounts in', () => {
    expect(isSplitPane(pane(true))).toBe(true);
  });

  it('reads each pane on its own, not the document', () => {
    const panes = document.createElement('div');
    const first = pane(false);
    const second = pane(true);
    panes.append(first.dom.closest('.editor')!, second.dom.closest('.editor')!);
    document.body.appendChild(panes);
    try {
      expect(isSplitPane(first)).toBe(false);
      expect(isSplitPane(second)).toBe(true);
    } finally {
      panes.remove();
    }
  });
});
