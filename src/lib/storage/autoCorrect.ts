// LibreOffice's Tools ▸ AutoCorrect Options ▸ Options / Localized Options, on by
// default as they are there. `urls` gates the Link extension's autolink, the rest
// the rules in editor/extensions/autoCorrect.ts.

export type AutoCorrectOptions = {
  quotes: boolean;
  dashes: boolean;
  replacements: boolean;
  capitalize: boolean;
  twoInitials: boolean;
  urls: boolean;
};

const KEY = 'edentext-autocorrect';

export const DEFAULT_AUTOCORRECT: AutoCorrectOptions = {
  quotes: true, dashes: true, replacements: true, capitalize: true, twoInitials: true, urls: true,
};

export const AUTOCORRECT_KEYS = Object.keys(DEFAULT_AUTOCORRECT) as (keyof AutoCorrectOptions)[];

export function loadAutoCorrect(): AutoCorrectOptions {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_AUTOCORRECT };
    const data = JSON.parse(raw) as Partial<AutoCorrectOptions>;
    const out = { ...DEFAULT_AUTOCORRECT };
    for (const key of AUTOCORRECT_KEYS) if (typeof data[key] === 'boolean') out[key] = data[key];
    return out;
  } catch {
    return { ...DEFAULT_AUTOCORRECT };
  }
}

export function saveAutoCorrect(opts: AutoCorrectOptions): void {
  localStorage.setItem(KEY, JSON.stringify(opts));
}
