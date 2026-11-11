import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { STATE_RESTORED } from '../editor/undo';
import { setAiHostOff } from '../storage/ai.svelte';

// A tab joined through a read link (`#view=`): the view takes no input, the assistant is
// off, headers and footers stay shut, and once bound only the shared doc changes the body.
// Commands run even when not editable, so the filter refuses every other step.

let on = $state(false);

export const readingKey = new PluginKey('readOnly');

/** Whether this tab reads along in a session. */
export function reading(): boolean {
  return on;
}

export function setReading(editor: Editor, value: boolean): void {
  on = value;
  setAiHostOff(value);
  editor.setEditable(!value);
}

/** Refuses each transaction with steps that did not come from the shared doc. */
export const readOnlyFilter = () => new Plugin({
  key: readingKey,
  filterTransaction: (tr) => !tr.steps.length || !!tr.getMeta(ySyncPluginKey) || !!tr.getMeta(STATE_RESTORED),
});
