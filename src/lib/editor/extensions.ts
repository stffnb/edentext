import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Underline from '@tiptap/extension-underline';
import Heading from '@tiptap/extension-heading';
import History from '@tiptap/extension-history';
import Placeholder from '@tiptap/extension-placeholder';

export const extensions = [
  Document,
  Paragraph,
  Text,
  Bold,
  Italic,
  Underline,
  Heading.configure({ levels: [1, 2, 3] }),
  History,
  Placeholder.configure({ placeholder: 'Start typing…' }),
];
