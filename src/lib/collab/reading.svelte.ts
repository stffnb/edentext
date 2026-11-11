import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { STATE_RESTORED } from '../editor/undo';
import { setAiHostOff } from '../storage/ai.svelte';
import { spellController } from '../spell/controller';

// A tab joined through a read link (`#view=`) takes no input, greys editing controls
// (ReadGate), shows no squiggles and keeps the assistant off and the zones shut. Commands
// run even when not editable, so the filter refuses steps not from the shared doc.

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
  // The spell check drops or brings back its squiggles.
  spellController.refresh();
}

/** Refuses each transaction with steps that did not come from the shared doc. */
export const readOnlyFilter = () => new Plugin({
  key: readingKey,
  filterTransaction: (tr) => !tr.steps.length || !!tr.getMeta(ySyncPluginKey) || !!tr.getMeta(STATE_RESTORED),
});
