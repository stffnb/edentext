import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { isWordChar, suggestCompletion, wordBefore } from '../../utils/wordCompletion';
import { rememberWord, wordCompletion } from '../../storage/wordCompletion.svelte';

// LibreOffice's Word Completion: the words this document has used are offered back
// while typing, Enter takes the offer. It is drawn as grey text after the caret
// rather than LibreOffice's tooltip — the completion is not in the document until
// it is accepted, so nothing has to be undone when it is not.

type Suggestion = { pos: number; text: string } | null;

const key = new PluginKey<Suggestion>('wordCompletion');
const DISMISS = 'wordCompletion/dismiss';

/** What is being offered at the caret, if anything. */
export const currentCompletion = (state: EditorState): string | null => key.getState(state)?.text ?? null;

function suggestionAt(state: EditorState): Suggestion {
  const opts = wordCompletion();
  if (!opts.enabled || !opts.words.length) return null;
  const { empty, $from } = state.selection;
  if (!empty || !$from.parent.isTextblock) return null;
  // Only at the end of a word: completing in the middle of one would guess at text
  // that is already there.
  const after = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, undefined, ' ');
  if (after && isWordChar(after[0])) return null;
  const prefix = wordBefore($from.parent.textBetween(0, $from.parentOffset, undefined, ' '));
  const tail = suggestCompletion(opts.words, prefix);
  return tail ? { pos: $from.pos, text: tail } : null;
}

/** The word just finished, remembered. */
function collectAt(state: EditorState, pos: number): void {
  const $pos = state.doc.resolve(pos);
  if (!$pos.parent.isTextblock) return;
  rememberWord(wordBefore($pos.parent.textBetween(0, $pos.parentOffset, undefined, ' ')));
}

export const WordCompletion = Extension.create({
  name: 'wordCompletion',
  // Ahead of the keymaps, or Enter would split the block before it can be taken as
  // "accept the completion".
  priority: 1000,

  addProseMirrorPlugins() {
    return [
      new Plugin<Suggestion>({
        key,
        state: {
          init: () => null,
          // Only while typing: moving the caret to the end of a word offers nothing,
          // or an Enter meant to split the paragraph would complete a word instead.
          apply(tr, old, _oldState, newState) {
            if (tr.getMeta(DISMISS)) return null;
            if (tr.docChanged) return suggestionAt(newState);
            return tr.selectionSet ? null : old;
          },
        },
        props: {
          decorations(state) {
            const s = key.getState(state);
            if (!s) return null;
            const span = document.createElement('span');
            span.className = 'word-completion';
            span.textContent = s.text;
            return DecorationSet.create(state.doc, [Decoration.widget(s.pos, span, { side: 1 })]);
          },

          // A word ends at the first character that is not part of one, which is where
          // both the list and the typed word are updated.
          handleTextInput(view, from, to, text) {
            if (from === to && text.length === 1 && !isWordChar(text)) collectAt(view.state, from);
            return false;
          },

          handleKeyDown(view, event) {
            const s = key.getState(view.state);
            if (event.key === 'Escape' && s) {
              view.dispatch(view.state.tr.setMeta(DISMISS, true));
              return true;
            }
            if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || view.composing) {
              return false;
            }
            if (!s) { collectAt(view.state, view.state.selection.from); return false; }
            const $pos = view.state.doc.resolve(s.pos);
            const word = wordBefore($pos.parent.textBetween(0, $pos.parentOffset, undefined, ' ')) + s.text;
            const space = wordCompletion().appendSpace ? ' ' : '';
            view.dispatch(view.state.tr.insertText(s.text + space, s.pos).scrollIntoView());
            rememberWord(word);
            return true;
          },
        },
      }),
    ];
  },
});
