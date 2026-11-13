import { t } from '../i18n/i18n.svelte';

// The browsers' wording for an import() whose chunk did not arrive.
export const CHUNK_FAILURE = /dynamically imported module|Importing a module script failed/i;

// A copy of the app may leave a language's dictionary and thesaurus out. A 404, or a
// server answering the missing path with its HTML page, means "not shipped": no failure.
export class NotServed extends Error {}

export async function fetchAsset(url: string): Promise<Response> {
  const res = await fetch(url);
  if (res.status === 404 || (res.ok && res.headers.get('content-type')?.includes('text/html'))) throw new NotServed(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

// One report for every asset the app fetches after start-up. The reason belongs in
// the message: a failure on someone else's browser is otherwise unreportable, and a
// lazy chunk a script blocker ate says so in plain words.
export async function reportLoadFailure(what: string, err: unknown): Promise<void> {
  const detail = (err as Error)?.message ?? String(err);
  const blocked = CHUNK_FAILURE.test(detail);
  // A redeploy removes this tab's build: its own chunk is gone. HEAD bypasses the service worker's cache.
  const replaced = blocked && await fetch(import.meta.url, { method: 'HEAD', cache: 'no-store' }).then((r) => r.status === 404, () => false);
  alert(`${what}\n\n${replaced ? t().dialogs.appUpdated : blocked ? t().dialogs.scriptBlocked : detail}`);
}
