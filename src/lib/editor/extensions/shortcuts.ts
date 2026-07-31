import { Extension, type Editor } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { Mark } from '@tiptap/pm/model';
import { DEFAULT_SHORTCUTS, type ShortcutId } from '../shortcuts';
import { FONT_SIZES, blockFontSize, coversWholeBlock } from '../../utils/fontSize';
import { headingStyleName } from '../../styles/styleSheet';
import { DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT } from '../../utils/dateTime';

// The Word/LibreOffice shortcuts that aren't already a TipTap default, bound from
// the central table. priority 1000 so Mod-Alt-N beats Heading's toggleHeading and
// Mod-Shift-b beats Bold's Mod-B alias.

type Binding = (editor: Editor) => boolean;

// The size to step from — the selection's first run, like the toolbar's size box.
// A range selection can't use $head: after Ctrl+A it sits outside the paragraph,
// where marks() is empty and every step would restart from the style default.
function currentSizePt(editor: Editor): number {
  const { state } = editor;
  const { from, to, empty, $head } = state.selection;
  const markSize = (marks: readonly Mark[]) =>
    marks.find((m) => m.type.name === 'textStyle')?.attrs.fontSize as string | undefined;

  let size: string | undefined;
  if (empty) size = markSize(state.storedMarks ?? $head.marks());
  else {
    state.doc.nodesBetween(from, to, (node, _pos, parent) => {
      if (size || !node.isText) return;
      size = markSize(node.marks) ?? blockFontSize(parent);
    });
  }
  return parseFloat(size || blockFontSize($head.parent)) || 12;
}

// Word's Ctrl+Shift+> / <: jump to the next size on the toolbar's ladder.
function stepFontSize(editor: Editor, dir: 1 | -1): boolean {
  const cur = currentSizePt(editor);
  const ladder = dir > 0 ? FONT_SIZES : [...FONT_SIZES].reverse();
  const next = ladder.find((s) => (dir > 0 ? s > cur : s < cur));
  if (next === undefined) return false;
  const { from, to } = editor.state.selection;
  const chain = editor.chain().focus().setFontSize(`${next}pt`);
  if ('setBlockFontSize' in editor.commands && coversWholeBlock(editor.state.doc, from, to)) {
    chain.setBlockFontSize(`${next}pt`);
  }
  return chain.run();
}

// Available in the body and in the header/footer editors.
const SHARED: Partial<Record<ShortcutId, Binding>> = {
  alignLeft: (e) => e.chain().focus().setTextAlign('left').run(),
  alignCenter: (e) => e.chain().focus().setTextAlign('center').run(),
  alignRight: (e) => e.chain().focus().setTextAlign('right').run(),
  alignJustify: (e) => e.chain().focus().setTextAlign('justify').run(),
  superscript: (e) => e.chain().focus().unsetSubscript().toggleSuperscript().run(),
  subscript: (e) => e.chain().focus().unsetSuperscript().toggleSubscript().run(),
  fontGrow: (e) => stepFontSize(e, 1),
  fontShrink: (e) => stepFontSize(e, -1),
  // Escaped: both characters are invisible in source.
  nbsp: (e) => e.chain().focus().insertContent('\u00A0').run(),
  softHyphen: (e) => e.chain().focus().insertContent('\u00AD').run(),
};

// Commands the single-paragraph header/footer schema doesn't have.
const BODY_ONLY: Partial<Record<ShortcutId, Binding>> = {
  clearFormattingAlt: (e) => e.commands.clearDirectFormatting(),
  lineHeight1: (e) => e.chain().focus().setLineHeight('1').run(),
  lineHeight2: (e) => e.chain().focus().setLineHeight('2').run(),
  lineHeight15: (e) => e.chain().focus().setLineHeight('1.5').run(),
  styleStandard: (e) => e.commands.setParagraphStyle('Standard'),
  dateField: (e) =>
    e.chain().focus().insertDateTimeField({ kind: 'date', format: DEFAULT_DATE_FORMAT, fixed: false }).run(),
  timeField: (e) =>
    e.chain().focus().insertDateTimeField({ kind: 'time', format: DEFAULT_TIME_FORMAT, fixed: false }).run(),
};

export const Shortcuts = Extension.create<{ body: boolean }>({
  name: 'shortcuts',
  priority: 1000,

  addOptions() {
    return { body: false };
  },

  addKeyboardShortcuts() {
    const bindings = { ...SHARED, ...(this.options.body ? BODY_ONLY : {}) };
    return Object.fromEntries(
      Object.entries(bindings).map(([id, run]) => [
        DEFAULT_SHORTCUTS[id as ShortcutId],
        () => run(this.editor),
      ]),
    );
  },

  addProseMirrorPlugins() {
    if (!this.options.body) return [];
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          // Ctrl+Alt+N can't go through the keymap: Windows reads Ctrl+Alt as AltGr, so
          // event.key is layout-dependent (German AltGr+2 = '²') and prosemirror-keymap
          // skips its keyCode fallback for exactly this combination.
          handleKeyDown(_view, event) {
            if (!(event.ctrlKey || event.metaKey) || !event.altKey || event.shiftKey) return false;
            const digit = /^Digit([0-5])$/.exec(event.code);
            if (!digit) return false;
            const level = Number(digit[1]);
            event.preventDefault();
            return editor.commands.setParagraphStyle(level ? headingStyleName(level) : 'Standard');
          },
        },
      }),
    ];
  },
});
