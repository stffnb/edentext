# `src/lib/editor/`

The TipTap extension registry (`extensions.ts`), the shortcut table, and the context-menu
builder. Per-extension notes live in `extensions/CLAUDE.md`.

## Keyboard shortcuts (`shortcuts.ts`, `extensions/shortcuts.ts`)

Word/LibreOffice key bindings. **`editor/shortcuts.ts` is the single source of truth**:
`DEFAULT_SHORTCUTS` maps a stable id to a combo in ProseMirror keymap syntax, and every
binding site reads it (the `Shortcuts` extension, `App.svelte`'s window handler, and the
`Mod-k`/`Mod-Enter`/`Mod-m`/`Tab` bindings still owned by `link.ts`/`pageBreak.ts`/
`paragraphStyle.ts`/`indent.ts`) — a planned remapping UI overrides that map alone.
TipTap's own defaults (`Mod-b/i/u`, `Mod-Shift-s/h`, `Mod-z`, `Mod-Shift-7/8`,
`Mod-Shift-l/e/r/j`) are **not** in the table; they aren't ours to bind.
`matchesEvent(e, combo)` serves the window handler (no keymap there), `shortcutHint(id)`
the tooltips (via `withShortcut`, which localizes Ctrl/Shift/Alt and swaps in ⌘/⇧/⌥ on Mac).

- **`Shortcuts` extension** — `priority: 1000` so `Mod-Alt-N` beats Heading's
  `toggleHeading` (headings are applied as *named styles*) and `Mod-Shift-b` beats Bold's
  `Mod-B` alias. Option `body: true` (only `extensions.ts`) adds the bindings whose
  commands the header/footer schema lacks; `hfExtensions()` registers the bare extension,
  which contributes the shared set only (alignment, sub/superscript, font grow/shrink,
  NBSP, soft hyphen).
- **`Mod-Alt-<digit>` can't go through the keymap**: Windows reads Ctrl+Alt as AltGr, so
  `event.key` is layout-dependent (German AltGr+2 = `²`) and prosemirror-keymap skips its
  keyCode fallback for exactly that modifier pair. Those seven run in `addProseMirrorPlugins`
  off `event.code` (`Digit0`–`Digit6`) instead — and **Heading's own `Mod-Alt-N` is dropped**
  (`extensions.ts`): every keymap plugin runs ahead of every `addProseMirrorPlugins` one, whatever
  the extension priority, and `toggleHeading` sets the level without the heading's named style.
- **F3 is shared**: AutoText expands a shortcut at the caret (both word processors' key), and the app's find-next runs only where it did not — the window handler bails on `defaultPrevented`, which the editor's keymap sets when a binding took the key.
- Deliberate resolutions: `Mod-m` stays LibreOffice's *clear formatting* (Word's
  increase-indent is Tab); `Ctrl+1/2/5` are Word's **line spacing**, so headings are
  Ctrl+Alt+N only; `Mod-Shift-s` stays strikethrough, so there's no Save-As key;
  sub/superscript follow LO (`Mod-Shift-b`/`Mod-Shift-p`) because Word's `Ctrl+=` pair
  collides with zoom; formatting marks use LO's `Ctrl+F10` (Word's `Ctrl+Shift+8` is
  TipTap's bullet list). `Ctrl+N` is unbindable in Chrome and therefore absent.
- `tests/unit/shortcuts.test.ts` asserts the table has no duplicate combo (the bindings
  are spread over several files, so nothing else can catch a collision) and covers
  `matchesEvent`.

## Right-click context menu (`contextMenuItems.ts`, `components/ContextMenu.svelte`)

Word's text context menu: clipboard, link, clear formatting — with the spelling
suggestions merged in as the first section (the old `SpellContextMenu.svelte`).
Deliberately flat: no submenus, so no indent column either.
`buildContextMenu(editor, { spell })` returns a `MenuEntry[]`
(item/sep) whose `run` closures call the same commands the toolbars use;
`ContextMenu.svelte` only renders it, positioned as a sibling of the zoomed `.paper` so
it stays constant-size. `Editor.svelte`'s `openContextMenu` (one `oncontextmenu` on
`.editor`) picks the caret (keeping a selection the click lands in, as Word does), reads
`spellErrorAt`, and builds the list. It bails on **Shift+right-click** (the browser menu,
whose Paste needs no clipboard permission — Firefox does this for page handlers anyway),
on images/text boxes (their floating toolbars), and in the header/footer (the HF schema
has none of the entries). Cut/copy go through `document.execCommand` so ProseMirror's own
copy handler builds the clipboard payload; paste reads `navigator.clipboard` and falls
back to an alert where the browser blocks it. The menu clamps itself into the viewport
via transforms, measured from layout offsets so the correction can't feed back into the
next measurement.
