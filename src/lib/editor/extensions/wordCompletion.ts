import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { isWordChar, suggestCompletion, wordBefore } from '../../utils/wordCompletion';
import { rememberWord, wordCompletion } from '../../storage/wordCompletion.svelte';
import { volatile } from '../../storage/docScope';
import { typedText } from './trackChanges';
import { placeAt } from './overlay';

// LibreOffice's Word Completion: the words this document has used are offered back
// while typing, Enter takes the offer. It is drawn as grey text after the caret
// rather than LibreOffice's tooltip — the completion is not in the document until
// it is accepted, so nothing has to be undone when it is not.

// The offer sits over the text rather than in it, in the font of the run it continues:
// anything inside the line would move its breaks. Placed again on every view update, so
// it follows a line pagination shifts.
function drawOffer(view: EditorView, offer: HTMLElement, s: { pos: number; text: string }): void {
  const { node, offset } = view.domAtPos(s.pos, -1);
  const last = node.nodeType === 1 ? node.childNodes[offset - 1] ?? node : node;
  const run = last.nodeType === 1 ? last as Element : last.parentElement;
  if (run) {
    const cs = getComputedStyle(run);
    for (const p of ['font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variant', 'letter-spacing', 'word-spacing']) {
      offer.style.setProperty(p, cs.getPropertyValue(p));
    }
    offer.style.setProperty('--offer-color', cs.color);
    offer.style.translate = cs.direction === 'rtl' ? '-100%' : '';
  }
  if (offer.textContent !== s.text) offer.textContent = s.text;
}

type Suggestion = { pos: number; text: string } | null;

const key = new PluginKey<Suggestion>('wordCompletion');
const DISMISS = 'wordCompletion/dismiss';

/** What is being offered at the caret, if anything. */
export const currentCompletion = (state: EditorState): string | null => key.getState(state)?.text ?? null;

function suggestionAt(state: EditorState): Suggestion {
  const opts = wordCompletion();
  if (volatile || !opts.enabled || !opts.words.length) return null;
  const { empty, $from } = state.selection;
  if (!empty || !$from.parent.isTextblock) return null;
  // Only at the end of a word: completing in the middle of one would guess at text
  // that is already there.
  const after = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, undefined, ' ');
  if (after && isWordChar(after[0])) return null;
  const prefix = wordBefore(typedText($from));
  const tail = suggestCompletion(opts.words, prefix);
  return tail ? { pos: $from.pos, text: tail } : null;
}

/** The word just finished, remembered. */
function collectAt(state: EditorState, pos: number): void {
  const $pos = state.doc.resolve(pos);
  if (!$pos.parent.isTextblock) return;
  rememberWord(wordBefore(typedText($pos)));
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
        view: (view) => {
          const offer = document.createElement('span');
          offer.className = 'word-completion';
          offer.setAttribute('aria-hidden', 'true');
          const draw = () => {
            const s = key.getState(view.state);
            if (!s || !placeAt(view, offer, s.pos)) { offer.remove(); return; }
            drawOffer(view, offer, s);
          };
          // A reflow without a transaction (a font arriving) moves the line under it.
          const resized = typeof ResizeObserver === 'function' ? new ResizeObserver(draw) : null;
          resized?.observe(view.dom);
          return { update: draw, destroy() { resized?.disconnect(); offer.remove(); } };
        },
        props: {
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
            const word = wordBefore(typedText($pos)) + s.text;
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
