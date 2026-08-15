import type { Editor } from '@tiptap/core';
import { t } from '../i18n/i18n.svelte';
import { withShortcut } from '../i18n/shortcut';
import { shortcutHint } from './shortcuts';
import { OPEN_LINK_DIALOG_EVENT } from './extensions/link';
import { OPEN_COMMENT_EVENT } from './extensions/comment';
import { OPEN_BOOKMARK_DIALOG_EVENT, bookmarkNames } from './extensions/bookmark';
import { OPEN_CROSS_REF_DIALOG_EVENT } from './extensions/crossReference';
import { OPEN_THESAURUS_EVENT } from '../spell/thesaurus';

// The right-click menu's contents, the usual text menu mapped onto this editor. Pure
// data + closures — ContextMenu.svelte only renders it.
export type MenuEntry =
  | { kind: 'sep' }
  | { kind: 'item'; label: string; hint?: string; disabled?: boolean; strong?: boolean; run: () => void };

export interface SpellSection {
  suggestions: string[];
  onReplace: (word: string) => void;
  onAdd: () => void;
  onIgnore: () => void;
}

// Cut/copy go through execCommand so ProseMirror's own copy handler builds the
// clipboard payload (HTML + its slice metadata) — formatting survives.
// ponytail: deprecated but the only route to that payload; revisit if a browser drops it.
export function clipboardCommand(editor: Editor, command: 'cut' | 'copy') {
  editor.view.focus();
  document.execCommand(command);
}

export async function readClipboard(editor: Editor, plainOnly: boolean) {
  const view = editor.view;
  view.focus();
  try {
    if (plainOnly) {
      view.pasteText(await navigator.clipboard.readText());
      return;
    }
    for (const item of await navigator.clipboard.read()) {
      if (item.types.includes('text/html')) {
        view.pasteHTML(await (await item.getType('text/html')).text());
        return;
      }
      if (item.types.includes('text/plain')) {
        view.pasteText(await (await item.getType('text/plain')).text());
        return;
      }
    }
  } catch {
    // Firefox/Safari gate clipboard reads behind their own paste affordance.
    alert(t().contextMenu.pasteBlocked);
  }
}

export function buildContextMenu(editor: Editor, opts: { spell?: SpellSection } = {}): MenuEntry[] {
  const m = t().contextMenu;
  const entries: MenuEntry[] = [];

  if (opts.spell) {
    const { suggestions, onReplace, onAdd, onIgnore } = opts.spell;
    if (suggestions.length) {
      for (const s of suggestions) entries.push({ kind: 'item', label: s, strong: true, run: () => onReplace(s) });
    } else {
      entries.push({ kind: 'item', label: t().spell.noSuggestions, disabled: true, run: () => {} });
    }
    entries.push({ kind: 'sep' });
    entries.push({ kind: 'item', label: t().spell.ignoreAll, run: onIgnore });
    entries.push({ kind: 'item', label: t().spell.addToDictionary, run: onAdd });
    entries.push({ kind: 'sep' });
  }

  const hasSelection = !editor.state.selection.empty;
  entries.push(
    { kind: 'item', label: m.cut, hint: withShortcut('Ctrl+X'), disabled: !hasSelection, run: () => clipboardCommand(editor, 'cut') },
    { kind: 'item', label: m.copy, hint: withShortcut('Ctrl+C'), disabled: !hasSelection, run: () => clipboardCommand(editor, 'copy') },
    { kind: 'item', label: m.paste, hint: withShortcut('Ctrl+V'), run: () => void readClipboard(editor, false) },
    { kind: 'item', label: m.pasteWithoutFormatting, hint: withShortcut('Ctrl+Shift+V'), run: () => void readClipboard(editor, true) },
    { kind: 'sep' },
  );

  const onLink = editor.isActive('link');
  entries.push({
    kind: 'item',
    label: onLink ? m.editLink : m.insertLink,
    hint: shortcutHint('link'),
    run: () => window.dispatchEvent(new CustomEvent(OPEN_LINK_DIALOG_EVENT)),
  });
  if (onLink) {
    entries.push({
      kind: 'item',
      label: m.removeLink,
      run: () => editor.chain().focus().extendMarkRange('link').unsetLink().run(),
    });
  }

  entries.push({
    kind: 'item',
    label: m.insertBookmark,
    disabled: !hasSelection,
    run: () => window.dispatchEvent(new CustomEvent(OPEN_BOOKMARK_DIALOG_EVENT)),
  });
  entries.push({
    kind: 'item',
    label: m.newComment,
    disabled: !hasSelection,
    run: () => window.dispatchEvent(new CustomEvent(OPEN_COMMENT_EVENT)),
  });
  entries.push({
    kind: 'item',
    label: m.insertCrossRef,
    disabled: !bookmarkNames(editor.state.doc).length,
    run: () => window.dispatchEvent(new CustomEvent(OPEN_CROSS_REF_DIALOG_EVENT)),
  });

  entries.push(
    { kind: 'sep' },
    {
      kind: 'item',
      label: t().thesaurus.menuItem,
      hint: shortcutHint('thesaurus'),
      run: () => window.dispatchEvent(new CustomEvent(OPEN_THESAURUS_EVENT)),
    },
    {
      kind: 'item',
      label: m.clearFormatting,
      hint: shortcutHint('clearFormatting'),
      run: () => editor.commands.clearDirectFormatting(),
    },
  );

  return entries;
}
