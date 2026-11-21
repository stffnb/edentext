import type { HostTemplate } from '../storage/hostConfig.svelte';
import { fetchAsset } from '../utils/loadFailure';

// A template the installation offers (storage/hostConfig.svelte.ts), fetched on demand:
// always revalidated, so a replaced file holds at once, and given up after 20 s.
export async function hostTemplateBytes(entry: HostTemplate): Promise<Uint8Array> {
  if (entry.bytes) return new Uint8Array(entry.bytes.slice(0));
  const res = await fetchAsset(entry.url!, { cache: 'no-cache', signal: AbortSignal.timeout(20_000) });
  return new Uint8Array(await res.arrayBuffer());
}

// The CSP allows pictures only from the app and inline, so a preview from elsewhere
// is fetched (connect-src is open) and shown from a blob; null leaves the sketch.
export async function hostTemplatePreview(entry: HostTemplate): Promise<string | null> {
  if (!entry.preview) return null;
  if (entry.preview.startsWith('data:')) return entry.preview;
  try {
    const res = await fetchAsset(entry.preview, { signal: AbortSignal.timeout(10_000) });
    const blob = await res.blob();
    return blob.type.startsWith('image/') ? URL.createObjectURL(blob) : null;
  } catch { return null; }
}
