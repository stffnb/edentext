import type { Content } from '@tiptap/core';
import type { PageMargins } from '../storage/pageMargins';
import type { Style } from '../styles/styleSheet';

// What a built-in template sets besides the content; applyTemplate (App.svelte)
// resets everything first, so an absent field keeps the app default.
export interface TemplateData {
  content: Content;
  margins?: PageMargins;
  /** Named paragraph styles the template ships, merged over the built-ins. */
  styles?: Style[];
  foldMarks?: boolean;
}

// name/description/build read t() at call time, so a template follows the UI locale.
export interface TemplateEntry {
  id: string;
  name: () => string;
  description: () => string;
  build: () => TemplateData;
}
