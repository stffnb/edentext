import OrderedListBase from '@tiptap/extension-ordered-list';
import { DEFAULT_ORDERED_TYPE } from './orderedListTypes';

// OrderedList carrying a `listStyleType` attr (one of the ORDERED_LIST_TYPES
// keys). Rendered as `data-list-style` on the <ol>; editor.css turns that into
// the on-screen marker (list-style-type / @counter-style) and export/odt.ts
// rewrites odf-kit's default numbering into the matching style:num-format.
//
// We spread the parent's attributes so the inherited `start`/`type` attrs (and
// their parse/render HTML) keep working.
export const OrderedList = OrderedListBase.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      listStyleType: {
        default: DEFAULT_ORDERED_TYPE,
        parseHTML: (element) => element.getAttribute('data-list-style') || DEFAULT_ORDERED_TYPE,
        renderHTML: (attributes) => {
          const v = attributes.listStyleType;
          // Omit the attr for the default so plain lists stay clean in the DOM.
          return v && v !== DEFAULT_ORDERED_TYPE ? { 'data-list-style': v } : {};
        },
      },
    };
  },
});
