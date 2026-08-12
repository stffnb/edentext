# The ribbon

A second chrome above the document, laid out like Word's ribbon. It does not replace the
floating command island — `chromeMode` picks which of the two mounts, so both can be used and
compared. Everything the ribbon drives is the same editor, through the same commands.

## The mode switch

`chromeMode: 'classic' | 'ribbon'` lives in `storage/theme.ts` beside the other UI-chrome prefs
(`odf-editor-chrome`, default `'classic'`). `App.svelte` forks on it: the ribbon docks as a plain
flex child, the island keeps its absolute overlay. Reachable from both sides — the theme dropdown
in classic, the strip's appearance menu in the ribbon.

`--toolbar-overlay-h` is written **only** in classic mode. `editor.css` reads it as
`var(--toolbar-overlay-h, 0px)`, so the ribbon's docked layout needs no second rule.

**Classic is the baseline the ribbon is measured against, so it stays untouched.** Where a shared
helper would improve both, the ribbon takes it and classic keeps its copy; where a dialog is
mounted inside `ToolbarExpanded`, the ribbon mounts its own rather than hoisting it. Only one
chrome is mounted at a time, so the two sets never coexist.

## Palette

Word's greys live in `--w-*` in `global.css`, deliberately **outside** the `[data-theme]` blocks:
the theme switcher styles the canvas, the page, the status bar and the classic toolbar, never the
ribbon. Accent `--w-accent: #185abd`; the tab's active underline is 2.5px **inset 13px from each
side**, not a full-width border.

`.ribbon` remaps the app's own tokens onto that palette (`--color-surface`, `--color-primary`,
`--toolbar-btn-size`, …). Custom properties inherit, so every reused picker — `ColorPicker`,
`HistoryButton`, `TablePicker`, `TableStylePicker`, the border pickers — adopts the ribbon's look
with no edit of its own, while the classic toolbar keeps the themed set.

Consequence, accepted: in dark and AllBlack the ribbon stays light while the rest of the app goes
dark.

## Layout

```
Ribbon.svelte
├─ .ribbon-tabs     File pill · quick access (save, undo, redo) · tabs · contextual tabs
│                   · spacer · document name · appearance · UI language
└─ .ribbon-body     the active tab's groups, a fixed --w-ribbon-h (96px) band
```

The band's height never changes: it scrolls horizontally with a hidden scrollbar instead of
collapsing groups into popovers the way Word does when the window narrows. That is the single
biggest simplification here, and the reason two things below are necessary.

- **A menu must leave the flow.** `.ribbon-body` clips its own overflow, so the `anchored` action
  (`ribbon/menu.svelte.ts`) switches a panel to `position: fixed` and pins it under its wrapper,
  clamped inside the window.
- **Each wrapper names the menu it owns.** One shared open-menu id means every `clickOutside`
  sees every mousedown; without the id each wrapper would close a sibling's open menu, and the
  click on one of its rows would never land.

## Pieces

| File | Role |
| --- | --- |
| `Ribbon.svelte` | Shell, tab state, the File menu, which contextual tabs are shown |
| `RibbonGroup.svelte` | A group: its controls, its visible label, Word's ↘ dialog launcher |
| `RibbonButton.svelte` | `big` / `small` / `icon`, plus the split button. Hover paints the **icon box**, not the whole button |
| `RibbonMenu.svelte` | The dropdown panel; its look is global CSS, since its rows come from a caller's snippet |
| `Icon.svelte`, `icons.ts` | Path data on a 16-unit canvas. `pinnedStroke(size)` holds the painted stroke at ~1.5px on large glyphs and ~1.1px on small ones, so 14px and 28px icons read as one family |
| `menu.svelte.ts` | The one open-menu id, `anchored`, `clickOutside` |
| `selection.ts` | `saveRange` / `withRange` — a popover steals focus, so the range is replayed before the command |
| `fontList.svelte.ts` | Recent, web-safe and detected fonts, shared by every font picker |
| `controls/` | Font family box, font size box, style gallery |
| `tabs/` | One file per tab |

Reading what the selection formats is **not** here: `utils/selectionFormat.ts` answers it
framework-free (`uniformFont`, `uniformFontSize`, `uniformMarkColor`, `uniformBlockAttr`), each
returning the shared value or `''` when the selection mixes two.

## Tabs

Fixed: **File** (a menu, not a backstage) · **Home** · **Insert** · **Layout** · **References** ·
**Review** · **View**. Contextual, shown while the caret is in the object: **Table Design**,
**Table Layout**, **Picture Format**, **Shape Format** — a tab that disappears hands the strip
back to Home.

The ribbon surfaces a good deal the engine already carried with nothing to reach it: change case,
underline and strikethrough line styles, Find and Replace as buttons, the page break, section
breaks, absolute left/right indent, the table-of-contents depth, cell margins, Save As.

## Dialogs

`ParagraphDialog` and `TabsDialog` open from Word's ↘ launcher in a group's corner. They are
chrome-agnostic, so classic could gain launchers of its own at no cost.

There is **no Font dialog**: the Home tab already carries change case and the underline and
strikethrough line styles, and the two things left over — `letterSpacingPt` and `kerning` — live
on a named style, not on a run. Setting them as direct formatting would mean a new mark attribute
and export work on both formats, which is more than a chrome rebuild. The style manager is where
they belong.

## What retiring classic would free

Recorded so the option stays visible, not as a plan: `Toolbar.svelte` and
`ToolbarExpanded.svelte` (~3200 lines), the overlay island and its hand-rolled horizontal
scrollbar in `App.svelte` (~120 lines plus CSS), the `pointer-events` opt-ins,
`--toolbar-overlay-h`, the collapsed-toolbar re-fire shim, `loadToolbarExpanded` /
`saveToolbarExpanded`, the duplicate dialog mounts, and `ToolbarExpanded`'s own copies of the
selection readers.
