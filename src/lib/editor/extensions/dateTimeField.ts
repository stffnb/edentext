import { Node, mergeAttributes } from '@tiptap/core';
import { locale } from '../../i18n/i18n.svelte';
import {
  findFormat, renderFormat, toDateValue, localeTag,
  DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT, type FieldKind,
} from '../../utils/dateTime';

// Inline atom for an inserted date/time field (Word's "Insert Date and Time"). A
// `fixed` field shows its stored `value`; an auto field renders the current time on
// load. Round-trips to ODF <text:date>/<text:time> and DOCX DATE/TIME fields.

export interface DateTimeFieldAttrs {
  kind: FieldKind;
  format: string;
  fixed: boolean;
  /** ISO local datetime captured at insert; the source for a fixed field's display. */
  value: string;
}

// The text a field shows: a fixed field uses its stored moment, an auto field "now".
export function dateTimeFieldText(attrs: DateTimeFieldAttrs): string {
  const fmt = findFormat(attrs.format)
    ?? findFormat(attrs.kind === 'time' ? DEFAULT_TIME_FORMAT : DEFAULT_DATE_FORMAT)!;
  const when = attrs.fixed && attrs.value ? new Date(attrs.value) : new Date();
  return renderFormat(fmt, isNaN(when.getTime()) ? new Date() : when, localeTag(locale()));
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    dateTimeField: {
      insertDateTimeField: (opts: { kind: FieldKind; format: string; fixed: boolean }) => ReturnType;
    };
  }
}

export const DateTimeField = Node.create({
  name: 'dateTimeField',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      kind: {
        default: 'date' as FieldKind,
        parseHTML: (el) => (el.getAttribute('data-datetime-field') === 'time' ? 'time' : 'date'),
        renderHTML: (attrs) => ({ 'data-datetime-field': attrs.kind }),
      },
      format: {
        default: DEFAULT_DATE_FORMAT,
        parseHTML: (el) => el.getAttribute('data-format') || DEFAULT_DATE_FORMAT,
        renderHTML: (attrs) => ({ 'data-format': attrs.format }),
      },
      fixed: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-fixed') === 'true',
        renderHTML: (attrs) => ({ 'data-fixed': attrs.fixed ? 'true' : 'false' }),
      },
      value: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-value') || '',
        renderHTML: (attrs) => ({ 'data-value': attrs.value }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-datetime-field]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), dateTimeFieldText(node.attrs as DateTimeFieldAttrs)];
  },

  renderText({ node }) {
    return dateTimeFieldText(node.attrs as DateTimeFieldAttrs);
  },

  addCommands() {
    return {
      insertDateTimeField: (opts) => ({ commands, state }) => {
        // Adopt the cursor's marks (font, size, …) so the atom renders like the
        // surrounding text instead of falling back to the editor's default font.
        const marks = (state.storedMarks ?? state.selection.$to.marks())
          .map((m) => ({ type: m.type.name, attrs: m.attrs }));
        return commands.insertContent({
          type: this.name,
          attrs: { kind: opts.kind, format: opts.format, fixed: opts.fixed, value: toDateValue(new Date()) },
          ...(marks.length ? { marks } : {}),
        });
      },
    };
  },
});
