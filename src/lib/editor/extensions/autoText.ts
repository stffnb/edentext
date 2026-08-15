import { Extension, type Editor } from '@tiptap/core';
import { wordBefore } from '../../utils/wordCompletion';
import { entryForShortcut, type AutoTextEntry } from '../../storage/autoText';
import { autoTextEntries } from '../../storage/autoText.svelte';

// LibreOffice's AutoText: a named block of text, inserted by name or by typing its
// shortcut and pressing F3. The entries live in storage/autoText.svelte.ts — they
// belong to the app, not to a document, exactly as they do in both products.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    autoText: {
      insertAutoText: (entry: AutoTextEntry) => ReturnType;
      expandAutoText: () => ReturnType;
    };
  }
}

/** The shortcut typed at the caret and the range it occupies, if it names an entry. */
function shortcutAt(editor: Editor): { entry: AutoTextEntry; from: number; to: number } | null {
  const { empty, $from } = editor.state.selection;
  if (!empty || !$from.parent.isTextblock) return null;
  const word = wordBefore($from.parent.textBetween(0, $from.parentOffset, undefined, ' '));
  const entry = word ? entryForShortcut(autoTextEntries(), word) : null;
  return entry ? { entry, from: $from.pos - word.length, to: $from.pos } : null;
}

export const AutoText = Extension.create({
  name: 'autoText',

  addCommands() {
    return {
      insertAutoText: (entry) => ({ commands }) => commands.insertContent(entry.html),
      expandAutoText: () => ({ editor, chain }) => {
        const hit = shortcutAt(editor);
        if (!hit) return false;
        return chain().focus().deleteRange({ from: hit.from, to: hit.to }).insertContent(hit.entry.html).run();
      },
    };
  },

  addKeyboardShortcuts() {
    return { F3: () => this.editor.commands.expandAutoText() };
  },
});
