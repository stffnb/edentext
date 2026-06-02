import { Extension } from '@tiptap/core';

// Paragraph spacing (space above / below a paragraph) — the LibreOffice/Word
// "paragraph spacing" model. Stored as a plain point value (pt) so it round-trips
// 1:1 to ODF's fo:margin-top / fo:margin-bottom on export. null means "inherit
// the style/CSS default" (≈0.212cm below for body text, 0 for list items), so
// untouched documents keep their existing spacing.
//
// On screen the value renders as an inline margin that overrides the base
// margins in editor.css; on export it is emitted as fo:margin-top/bottom (see
// export/odt.ts), including for list-item paragraphs.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphSpacing: {
      setSpaceBefore: (pt: number | null) => ReturnType;
      setSpaceAfter: (pt: number | null) => ReturnType;
    };
  }
}

function parseSpacing(value: string | null): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export const ParagraphSpacing = Extension.create({
  name: 'paragraphSpacing',

  addOptions() {
    return {
      types: ['paragraph', 'heading'] as string[],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          spaceBefore: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              parseSpacing(element.getAttribute('data-space-before')),
            renderHTML: (attributes: Record<string, unknown>) => {
              if (attributes.spaceBefore == null) return {};
              const pt = Number(attributes.spaceBefore);
              return {
                'data-space-before': String(pt),
                style: `margin-top: ${pt}pt`,
              };
            },
          },
          spaceAfter: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              parseSpacing(element.getAttribute('data-space-after')),
            renderHTML: (attributes: Record<string, unknown>) => {
              if (attributes.spaceAfter == null) return {};
              const pt = Number(attributes.spaceAfter);
              return {
                'data-space-after': String(pt),
                style: `margin-bottom: ${pt}pt`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setSpaceBefore: (pt: number | null) => ({ commands }) => {
        return this.options.types
          .map((type) => commands.updateAttributes(type, { spaceBefore: pt }))
          .some((r) => r);
      },
      setSpaceAfter: (pt: number | null) => ({ commands }) => {
        return this.options.types
          .map((type) => commands.updateAttributes(type, { spaceAfter: pt }))
          .some((r) => r);
      },
    };
  },
});
