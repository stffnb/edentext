import { Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { LINE, PARAGRAPH, compose } from '../../dictation/commands';
import { matchRunFont, placeAt } from './overlay';

// Dictation in the editor (docs/architecture/dictation.md). The words still being heard
// are plugin state drawn over the page at the selection, never document content; a settled
// phrase is one ordinary transaction, so it inherits the caret's marks, records and undoes as typing.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    dictation: {
      /** Shows the words still being heard at the selection; '' hides them. */
      setDictationInterim: (text: string) => ReturnType;
      /** Inserts a settled phrase over the selection, spaced, capitalized and with its spoken commands applied. */
      insertDictation: (text: string, lang: string) => ReturnType;
    };
  }
}

const key = new PluginKey<string>('dictation');

/** The words shown as still being heard. */
export const dictationInterim = (state: Parameters<typeof key.getState>[0]): string => key.getState(state) ?? '';

export const Dictation = Extension.create({
  name: 'dictation',

  addCommands() {
    return {
      setDictationInterim: (text) => ({ tr, dispatch }) => {
        if (dispatch) tr.setMeta(key, text).setMeta('addToHistory', false);
        return true;
      },
      insertDictation: (text, lang) => ({ tr, dispatch, commands }) => {
        const { $from, $to } = tr.selection;
        if (!$from.parent.inlineContent) return false;
        const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\uFFFC');
        const after = $to.parent.textBetween($to.parentOffset, $to.parent.content.size, undefined, '\uFFFC');
        const out = compose(before, text, lang, after);
        if (!out) return false;
        if (!dispatch) return true;
        // Its own undo step, however soon the next phrase follows.
        closeHistory(tr).setMeta(key, '');
        for (const part of out.split(/([\u2028\u2029])/)) {
          if (part === PARAGRAPH) commands.splitBlock();
          else if (part === LINE) commands.setHardBreak();
          else if (part) tr.insertText(part);
        }
        tr.scrollIntoView();
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<string>({
        key,
        state: {
          init: () => '',
          apply: (tr, old) => tr.getMeta(key) ?? old,
        },
        // Over the page, in the run's font: inside the line it would move the line breaks.
        view: (view) => {
          const el = document.createElement('span');
          el.className = 'dictation-interim';
          el.setAttribute('aria-hidden', 'true');
          const draw = () => {
            const text = key.getState(view.state) ?? '';
            const pos = view.state.selection.from;
            if (!text || !placeAt(view, el, pos)) { el.remove(); return; }
            matchRunFont(view, el, pos);
            if (el.textContent !== text) el.textContent = text;
          };
          return { update: draw, destroy: () => el.remove() };
        },
      }),
    ];
  },
});
