// The embed bridge answers only the host that introduced itself, and with VITE_EMBED_ORIGINS
// or embed.config.json only the hosts they name.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmbedApi } from '../../src/lib/embed/bridge';

vi.stubGlobal('__APP_VERSION__', 'test');

// `config` is embed.config.json's body; without it the file is not there.
async function bridge(origins?: string, config?: string) {
  vi.resetModules();
  if (origins !== undefined) vi.stubEnv('VITE_EMBED_ORIGINS', origins);
  vi.stubGlobal('fetch', vi.fn(async () => (config === undefined ? new Response('', { status: 404 }) : new Response(config))));
  const configure = vi.fn();
  const api = { configure, load: vi.fn(), newDocument: vi.fn(), exportAs: vi.fn(), markSaved: vi.fn() } as unknown as EmbedApi;
  await (await import('../../src/lib/embed/bridge')).startBridge(api);
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
    ['a host embed.config.json lists', undefined, ['https://b.example', 'https://a.example'], 1, '{"origins":["https://a.example"]}'],
    ['its own origin as "self"', undefined, ['https://a.example', location.origin], 1, '{"origins":["self"]}'],
    ['no host from a malformed embed.config.json', undefined, ['https://a.example'], 0, '{"origin":"https://a.example"}'],
    ['the build list over embed.config.json', 'https://a.example', ['https://a.example'], 1, '{"origins":[]}'],
  ])('takes %s, pinned at the first init', async (_, origins, hosts, expected, config?: string) => {
    const { configure, send } = await bridge(origins, config);
    for (const h of hosts) await send(h, 'init');
    await send('https://evil.example', 'configure');
    expect(configure).toHaveBeenCalledTimes(expected);
  });
});
