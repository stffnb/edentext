import OrderedListBase from '@tiptap/extension-ordered-list';
import { DEFAULT_ORDERED_TYPE } from './orderedListTypes';

// OrderedList with a `listStyleType` attr (an ORDERED_LIST_TYPES key), rendered
// as `data-list-style` on the <ol>: editor.css maps it to the on-screen marker,
// export/odt.ts to style:num-format. Parent attrs spread in to keep start/type.
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
