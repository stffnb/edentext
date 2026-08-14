// LibreOffice's Table ▸ Number Recognition, **off** by default there (its
// Writer/Table/Input/NumberRecognition schema default) and so here. The locale a
// cell's number is read and written in is the document's language, as it is there.

import { loadDocumentLanguage, NO_LANGUAGE } from './documentLanguage';
import { numberLocale, type NumberLocale } from '../utils/tableFormula';

const KEY = 'edentext-number-recognition';

let recognize = $state(localStorage.getItem(KEY) === 'true');
let lang = $state(loadDocumentLanguage());
const loc = $derived(numberLocale(lang === NO_LANGUAGE ? 'en' : lang));

export function numberRecognition(): boolean {
  return recognize;
}

export function setNumberRecognition(on: boolean): void {
  recognize = on;
  if (on) localStorage.setItem(KEY, 'true');
  else localStorage.removeItem(KEY);
}

export function setTableLanguage(code: string): void {
  lang = code;
}

export function tableLanguage(): string {
  return lang === NO_LANGUAGE ? 'en' : lang;
}

export function tableNumberLocale(): NumberLocale {
  return loc;
}
