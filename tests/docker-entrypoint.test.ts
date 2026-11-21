// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// The image's start script (docker/40-edentext.sh) against a copy of nginx's default site.
const script = resolve(__dirname, '../docker/40-edentext.sh');
const SITE = 'server {\n    listen 80;\n    location / {\n        root /usr/share/nginx/html;\n    }\n}\n';
let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

function start(env: Record<string, string>) {
  dir = mkdtempSync(join(tmpdir(), 'edentext-entry-'));
  mkdirSync(join(dir, 'html'));
  mkdirSync(join(dir, 'nginx/conf.d'), { recursive: true });
  writeFileSync(join(dir, 'nginx/conf.d/default.conf'), SITE);
  const run = spawnSync('sh', [script], {
    env: { PATH: process.env.PATH, EDENTEXT_HTML_DIR: join(dir, 'html'), EDENTEXT_NGINX_DIR: join(dir, 'nginx'), ...env },
    encoding: 'utf8',
  });
  const proxies = join(dir, 'nginx/edentext.d/proxy.conf');
  return {
    status: run.status,
    stderr: run.stderr,
    site: readFileSync(join(dir, 'nginx/conf.d/default.conf'), 'utf8'),
    proxies: existsSync(proxies) ? readFileSync(proxies, 'utf8') : '',
  };
}

describe('docker entrypoint', () => {
  it('leaves nginx untouched without proxy variables', () => {
    const out = start({});
    expect(out.status).toBe(0);
    expect(out.site).toBe(SITE);
    expect(out.proxies).toBe('');
  });

  it.each([
    ['/ai/', { EDENTEXT_AI_PROXY_UPSTREAM: 'https://api.example.org' }],
    ['/relay', { EDENTEXT_RELAY_UPSTREAM: 'http://relay:4390/' }],
  ])('adds the %s location and includes it once in the site', (path, env) => {
    const out = start(env);
    expect(out.status).toBe(0);
    expect(out.proxies).toContain(`location ${path} {`);
    expect(out.site.match(/include .*edentext\.d\/\*\.conf;/g)).toHaveLength(1);
  });

  it('passes the relay path unchanged, with the WebSocket upgrade and the client address', () => {
    const out = start({ EDENTEXT_RELAY_UPSTREAM: 'http://relay:4390/', EDENTEXT_RELAY_TRUSTED_PROXIES: '10.0.0.0/8, fd00::/8' });
    expect(out.proxies).toMatch(/proxy_pass http:\/\/relay:4390;/);
    expect(out.proxies).toMatch(/proxy_set_header Upgrade \$http_upgrade;/);
    expect(out.proxies).toMatch(/proxy_set_header X-Real-IP \$remote_addr;/);
    expect(out.proxies).toMatch(/set_real_ip_from 10\.0\.0\.0\/8;\s+set_real_ip_from fd00::\/8;/);
  });

  it.each([
    { EDENTEXT_RELAY_UPSTREAM: 'relay:4390' },
    { EDENTEXT_RELAY_UPSTREAM: 'ws://relay:4390' },
    { EDENTEXT_RELAY_UPSTREAM: 'http://relay:4390/relay' },
    { EDENTEXT_RELAY_UPSTREAM: 'http://relay:4390;return 200' },
    { EDENTEXT_RELAY_UPSTREAM: 'http://relay:4390', EDENTEXT_RELAY_TRUSTED_PROXIES: '10.0.0.0/8;' },
  ])('refuses a relay setting nginx cannot take: %o', (env) => {
    const out = start(env);
    expect(out.status).not.toBe(0);
    expect(out.stderr).toMatch(/EDENTEXT_RELAY_/);
  });
});
