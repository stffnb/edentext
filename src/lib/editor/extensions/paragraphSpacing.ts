import { Extension } from '@tiptap/core';

// Space above/below a paragraph in pt, round-tripping 1:1 to fo:margin-top/bottom;
// null inherits the style default. Space before rides `--space-before`, which editor.css
// turns into padding or margin per the document's spacing model (storage/spacingModel.ts).

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
      // textBox: a box lifted out of its anchor paragraph carries that paragraph's
      // spacing, since it stands in its place (import/odt.ts).
      types: ['paragraph', 'heading', 'textBox'] as string[],
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
                style: `--space-before: ${pt}pt`,
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
