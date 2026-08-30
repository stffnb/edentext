import { din5008a, din5008b } from './din5008';
import { privateLetter } from './privateLetter';
import { coverLetter } from './coverLetter';
import { cv } from './cv';
import { invoice } from './invoice';
import { minutes } from './minutes';
import type { TemplateEntry } from './types';

// What the gallery offers.
export const TEMPLATES: TemplateEntry[] = [din5008b, din5008a, privateLetter];

// Drafts kept compiling and tested but not selectable; move up once settled.
export const SHELVED: TemplateEntry[] = [coverLetter, cv, invoice, minutes];
