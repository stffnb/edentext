import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { paintFormat, type PaintOptions } from '../../utils/formatPainter';
import { paintedFormat, painting, paintingOn, stopPainting } from '../formatPainter.svelte';
import { closeGroup } from '../undo';
import { ySyncPluginKey } from '@tiptap/y-tiptap';

const PAINTED = new PluginKey('formatPainter');

/** Puts the picked format on the view's selection: one transaction, one undo step. */
export function paintSelection(view: EditorView, opts: PaintOptions = {}): boolean {
  const format = paintedFormat();
  if (!format || !view.editable) return false;
  const tr = paintFormat(view.state, format, opts);
  if (tr) {
    closeGroup(tr);
    view.dispatch(tr.setMeta(PAINTED, true));
  }
  if (!paintingOn()) stopPainting();
  return !!tr;
}

// While a format is picked, the end of a mouse selection in this view paints it. Ctrl or Cmd
// held paints every paragraph touched as well, with Shift those alone (LibreOffice's keys).
export const FormatPainter = Extension.create({
  name: 'formatPainter',

  addProseMirrorPlugins() {
    return [new Plugin({
      key: PAINTED,
      props: {
        handleDOMEvents: {
          mousedown(view, event) {
            if (!painting() || event.button !== 0) return false;
            // The button may come up outside the page, and the selection is read in after it.
            window.addEventListener('mouseup', (up) => {
              const mod = up.ctrlKey || up.metaKey;
              setTimeout(() => {
                if (!view.isDestroyed) paintSelection(view, { chars: !(mod && up.shiftKey), touched: mod });
              });
            }, { once: true, capture: true });
            return false;
          },
        },
      },
      // Any other edit of the user's puts the brush down; repairs and remote edits do not.
      appendTransaction(trs) {
        if (painting() && trs.some((tr) => tr.docChanged && !tr.getMeta(PAINTED) && !tr.getMeta('appendedTransaction')
          && !tr.getMeta(ySyncPluginKey) && tr.getMeta('addToHistory') !== false)) stopPainting();
        return null;
      },
    })];
  },
});
