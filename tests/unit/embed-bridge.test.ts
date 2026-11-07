// The embed bridge answers only the host that introduced itself, and a build with
// VITE_EMBED_ORIGINS only the hosts it names.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmbedApi } from '../../src/lib/embed/bridge';

vi.stubGlobal('__APP_VERSION__', 'test');

async function bridge(origins?: string) {
  vi.resetModules();
  if (origins !== undefined) vi.stubEnv('VITE_EMBED_ORIGINS', origins);
  const configure = vi.fn();
  const api = { configure, load: vi.fn(), newDocument: vi.fn(), exportAs: vi.fn(), markSaved: vi.fn() } as unknown as EmbedApi;
  (await import('../../src/lib/embed/bridge')).startBridge(api);
  const send = async (origin: string, type: string) => {
    window.dispatchEvent(new MessageEvent('message', { data: { edentext: 1, type, id: 1 }, origin, source: window }));
    await Promise.resolve();
  };
  return { configure, send };
}

afterEach(() => vi.unstubAllEnvs());

describe('embed bridge origins', () => {
  it.each([
    ['any host by default', undefined, ['https://a.example', 'https://b.example'], 1],
    ['a listed host', 'https://b.example, https://a.example', ['https://a.example'], 1],
    ['no unlisted host', 'https://b.example', ['https://a.example'], 0],
  ])('takes %s, pinned at the first init', async (_, origins, hosts, expected) => {
    const { configure, send } = await bridge(origins);
    for (const h of hosts) await send(h, 'init');
    await send('https://evil.example', 'configure');
    expect(configure).toHaveBeenCalledTimes(expected);
  });
});
