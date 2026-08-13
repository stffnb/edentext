// The document's note settings as a reactive singleton (same shape as sheet.svelte.ts):
// the extension reads noteSettings() when it renumbers, the dialog replaces it.

import { clampNoteSettings, loadNoteSettings, saveNoteSettings, type NoteSettings } from './noteSettings';

let current = $state<NoteSettings>(loadNoteSettings());

export function noteSettings(): NoteSettings {
  return current;
}

export function setNoteSettings(next: NoteSettings): void {
  current = clampNoteSettings(next);
  saveNoteSettings(current);
}
