import type { Editor } from '@tiptap/core';
import { t } from '../i18n/i18n.svelte';
import { withShortcut } from '../i18n/shortcut';
import { shortcutHint } from './shortcuts';
import { OPEN_LINK_DIALOG_EVENT } from './extensions/link';
import { OPEN_COMMENT_EVENT } from './extensions/comment';
import { OPEN_BOOKMARK_DIALOG_EVENT, bookmarkNames } from './extensions/bookmark';
import { OPEN_CROSS_REF_DIALOG_EVENT, hasRefTargets } from './extensions/crossReference';
import { OPEN_THESAURUS_EVENT } from '../spell/thesaurus';
import { outerOrderedListAt } from './extensions/listStyle';
import { changesAt } from './extensions/trackChanges';
import { whenUnlocked } from '../storage/trackChanges.svelte';
import { aiEnabled, OPEN_AI_CHAT_EVENT } from '../storage/ai.svelte';
import { COMMANDS } from '../ai/commands';

// The right-click menu's contents, the usual text menu mapped onto this editor. Pure
// data + closures — ContextMenu.svelte only renders it.
export type MenuEntry =
  | { kind: 'sep' }
  | { kind: 'item'; label: string; hint?: string; disabled?: boolean; strong?: boolean; checked?: boolean; run: () => void }
  | { kind: 'sub'; label: string; items: MenuEntry[]; disabled?: boolean; title?: string };

export interface SpellSection {
  suggestions: string[];
  onReplace: (word: string) => void;
  /** Absent while there is no personal dictionary. */
  onAdd?: () => void;
  onIgnore: () => void;
}

export interface GrammarSection {
  message: string;
  suggestions: string[];
  // By index, not by label: two suggestions can read the same.
  onApply: (index: number) => void;
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

export function buildContextMenu(editor: Editor, opts: { spell?: SpellSection; grammar?: GrammarSection } = {}): MenuEntry[] {
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
    if (onAdd) entries.push({ kind: 'item', label: t().spell.addToDictionary, run: onAdd });
    entries.push({ kind: 'sep' });
  }

  if (opts.grammar) {
    const { message, suggestions, onApply, onIgnore } = opts.grammar;
    entries.push({ kind: 'item', label: message, disabled: true, run: () => {} });
    entries.push({ kind: 'sep' });
    if (suggestions.length) {
      suggestions.forEach((s, i) => entries.push({ kind: 'item', label: s, strong: true, run: () => onApply(i) }));
    } else {
      entries.push({ kind: 'item', label: t().spell.noSuggestions, disabled: true, run: () => {} });
    }
    entries.push({ kind: 'sep' });
    entries.push({ kind: 'item', label: t().grammar.ignore, run: onIgnore });
    entries.push({ kind: 'sep' });
  }

  // The change under the caret, or all the selection touches.
  if (changesAt(editor.state)) {
    const { accept, reject } = t().revisions;
    entries.push(
      { kind: 'item', label: accept, run: () => whenUnlocked(() => editor.chain().focus().acceptRevisions().run()) },
      { kind: 'item', label: reject, run: () => whenUnlocked(() => editor.chain().focus().rejectRevisions().run()) },
      { kind: 'sep' },
    );
  }

  const hasSelection = !editor.state.selection.empty;
  entries.push(
    { kind: 'item', label: m.cut, hint: withShortcut('Ctrl+X'), disabled: !hasSelection, run: () => clipboardCommand(editor, 'cut') },
    { kind: 'item', label: m.copy, hint: withShortcut('Ctrl+C'), disabled: !hasSelection, run: () => clipboardCommand(editor, 'copy') },
    { kind: 'item', label: m.paste, hint: withShortcut('Ctrl+V'), run: () => void readClipboard(editor, false) },
    { kind: 'item', label: m.pasteWithoutFormatting, hint: withShortcut('Ctrl+Shift+V'), run: () => void readClipboard(editor, true) },
    { kind: 'sep' },
  );

  // An ordered list counts on from the one before it, or restarts at 1.
  const list = outerOrderedListAt(editor.state);
  if (list) {
    const { pos, node, canContinue } = list;
    const setNumbering = (continueNumbering: boolean) => () => editor.chain().focus()
      .command(({ tr }) => { tr.setNodeMarkup(pos, undefined, { ...node.attrs, continueNumbering, start: 1 }); return true; }).run();
    entries.push(
      { kind: 'item', label: m.continueNumbering, disabled: !canContinue || !!node.attrs.continueNumbering, run: setNumbering(true) },
      { kind: 'item', label: m.restartNumbering, disabled: !node.attrs.continueNumbering && node.attrs.start === 1, run: setNumbering(false) },
      { kind: 'sep' },
    );
  }

  // The body only: the assistant does not work in a header or footer, whose schema has no
  // comment mark. Shown while it is off too, greyed, so the way to turn it on is findable.
  if (editor.schema.marks.comment) {
    const ai = t().ai;
    const chat = (prefill: string, send = false) => () => window.dispatchEvent(new CustomEvent(OPEN_AI_CHAT_EVENT, { detail: { prefill, send } }));
    entries.push(
      { kind: 'sub', label: ai.group, disabled: !aiEnabled(), title: aiEnabled() ? undefined : ai.offHint, items: [
        // A preset runs in the chat at once; translate waits there for its language.
        ...COMMANDS.filter((c) => c.preset).map((c): MenuEntry => ({ kind: 'item', label: ai.presets[c.preset!], disabled: !hasSelection,
          run: c.preset === 'translate' ? chat('/translate ') : chat(`/${c.name}`, true) })),
        { kind: 'sep' },
        { kind: 'item', label: ai.rewriteMenu, disabled: !hasSelection, run: chat('/rewrite ') },
        { kind: 'item', label: ai.draftMenu, hint: shortcutHint('aiDraft'), run: chat('/draft ') },
        { kind: 'item', label: ai.openChat, run: chat('') },
      ] },
      { kind: 'sep' },
    );
  }

  const onLink = editor.isActive('link');
  entries.push({
    kind: 'item',
    label: onLink ? m.editLink : m.insertLink,
    hint: shortcutHint('link'),
    run: () => window.dispatchEvent(new CustomEvent(OPEN_LINK_DIALOG_EVENT)),
  });
  if (onLink) {
    const href = editor.getAttributes('link').href as string | undefined;
    if (href) entries.push({ kind: 'item', label: m.copyLink, run: () => void navigator.clipboard?.writeText(href) });
    entries.push({
      kind: 'item',
      label: m.removeLink,
      run: () => editor.chain().focus().extendMarkRange('link').unsetLink().run(),
    });
  }

  // Nor a bookmark: the zone's schema has no such mark either.
  if (editor.schema.marks.bookmark) {
    entries.push({
      kind: 'item',
      label: m.insertBookmark,
      run: () => window.dispatchEvent(new CustomEvent(OPEN_BOOKMARK_DIALOG_EVENT)),
    });
  }
  // A header or footer takes no comment (its schema has no such mark).
  if (editor.schema.marks.comment) {
    entries.push({
      kind: 'item',
      label: m.newComment,
      disabled: !hasSelection,
      run: () => window.dispatchEvent(new CustomEvent(OPEN_COMMENT_EVENT)),
    });
  }
  entries.push({
    kind: 'item',
    label: m.insertCrossRef,
    disabled: !hasRefTargets(editor.state.doc),
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
