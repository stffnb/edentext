declare module 'nspell' {
  export interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    spell(word: string): { correct: boolean; forbidden: boolean; warn: boolean };
    add(word: string, model?: string): NSpell;
    remove(word: string): NSpell;
    wordCharacters(): string[] | undefined;
  }
  export default function nspell(aff: string, dic: string): NSpell;
}
