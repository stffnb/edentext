import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';

const formattingMarksKey = new PluginKey<DecorationSet>('formattingMarks');

const FORCE_REBUILD_META = 'formattingMarks/forceRebuild';

function isEnabled(domRoot: HTMLElement | null): boolean {
  return !!domRoot?.closest('.paper')?.classList.contains('show-formatting-marks');
}

function buildDecorations(doc: PmNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text ?? '';
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 32) {
        const from = pos + i;
        decos.push(Decoration.inline(from, from + 1, { class: 'pm-space-mark' }));
      }
    }
  });
  return decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty;
}

export const FormattingMarks = Extension.create({
  name: 'formattingMarks',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: formattingMarksKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr: Transaction, old: DecorationSet, _oldState: EditorState, newState: EditorState) {
            const force = tr.getMeta(FORCE_REBUILD_META) === true;
            // Enabled-state comes from the `.paper` DOM class; the view hook's
            // MutationObserver fires FORCE_REBUILD when it toggles. Before the
            // view exists we can't read the DOM, so map the previous set through.
            if (typeof document === 'undefined') {
              return tr.docChanged ? old.map(tr.mapping, tr.doc) : old;
            }
            const enabled = document.querySelector('.paper.show-formatting-marks') !== null;
            if (!enabled) return DecorationSet.empty;
            if (force || tr.docChanged) return buildDecorations(newState.doc);
            return old;
          },
        },
        props: {
          decorations(state) {
            return formattingMarksKey.getState(state);
          },
        },
        view(editorView) {
          const paper = editorView.dom.closest('.paper') as HTMLElement | null;
          let observer: MutationObserver | null = null;

          const triggerRebuild = () => {
            editorView.dispatch(editorView.state.tr.setMeta(FORCE_REBUILD_META, true));
          };

          if (paper) {
            observer = new MutationObserver((mutations) => {
              for (const m of mutations) {
                if (m.type === 'attributes' && m.attributeName === 'class') {
                  triggerRebuild();
                  break;
                }
              }
            });
            observer.observe(paper, { attributes: true, attributeFilter: ['class'] });
          }

          // Initial pass: if the class is already on at mount-time, render now.
          if (isEnabled(editorView.dom)) {
            queueMicrotask(triggerRebuild);
          }

          return {
            destroy() {
              observer?.disconnect();
            },
          };
        },
      }),
    ];
  },
});
