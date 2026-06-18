import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import { spellController } from '../spell/controller';

const spellCheckKey = new PluginKey<DecorationSet>('spellCheck');

const FORCE_RECHECK_META = 'spellCheck/forceRecheck';

// Re-check after the user pauses, so large docs stay responsive while typing.
const DEBOUNCE_MS = 400;

// A word is a letter run with internal apostrophes/hyphens only (don't,
// well-known) — never leading/trailing separators, so the checked token is
// exactly the highlighted range.
const WORD_RE = /[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*/gu;

function buildDecorations(doc: PmNode): DecorationSet {
  if (!spellController.isEnabled()) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text ?? '';
    WORD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD_RE.exec(text)) !== null) {
      const word = m[0];
      if (word.length < 2 || spellController.check(word)) continue;
      const from = pos + m.index;
      decos.push(Decoration.inline(from, from + word.length, { class: 'pm-spell-error' }));
    }
  });
  return decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty;
}

// The misspelled-word range covering `pos`, if any — used by the context menu.
export function spellErrorAt(state: EditorState, pos: number): { from: number; to: number } | null {
  const set = spellCheckKey.getState(state);
  if (!set) return null;
  const found = set.find(pos, pos);
  return found.length ? { from: found[0].from, to: found[0].to } : null;
}

export const SpellCheck = Extension.create({
  name: 'spellCheck',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: spellCheckKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr: Transaction, old: DecorationSet, _oldState: EditorState, newState: EditorState) {
            // Full recompute on demand; otherwise keep squiggles glued to text by
            // mapping them through the change (a debounced recheck follows).
            if (tr.getMeta(FORCE_RECHECK_META) === true) return buildDecorations(newState.doc);
            return tr.docChanged ? old.map(tr.mapping, tr.doc) : old;
          },
        },
        props: {
          decorations(state) {
            return spellCheckKey.getState(state);
          },
        },
        view(editorView) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const recheck = () => {
            editorView.dispatch(editorView.state.tr.setMeta(FORCE_RECHECK_META, true));
          };
          const scheduleRecheck = () => {
            if (timer !== undefined) clearTimeout(timer);
            timer = setTimeout(() => {
              timer = undefined;
              recheck();
            }, DEBOUNCE_MS);
          };

          // Language / personal-dictionary / ignore changes re-check immediately.
          const unsubscribe = spellController.subscribe(recheck);
          // Initial pass in case the checker is already loaded at mount.
          queueMicrotask(recheck);

          return {
            update(view, prevState) {
              if (!view.state.doc.eq(prevState.doc)) scheduleRecheck();
            },
            destroy() {
              if (timer !== undefined) clearTimeout(timer);
              unsubscribe();
            },
          };
        },
      }),
    ];
  },
});
