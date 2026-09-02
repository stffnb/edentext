// Password protection against LibreOffice, both ways: it opens what we encrypt, and we
// open what it encrypts. Needs soffice and python3-uno; self-skips without either, so
// plain `npm test` / CI stay green.
import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { buildOdt } from '../src/lib/export/odt';
import { buildDocx } from '../src/lib/export/docx';
import { importOdt } from '../src/lib/import/odt';
import { importDocx } from '../src/lib/import/docx';
import { encryptOdf, decryptOdf } from '../src/lib/crypto/odf';
import { encryptOoxml, decryptOoxml } from '../src/lib/crypto/ooxml';

function has(command: string): boolean {
  try { execSync(command, { stdio: 'ignore' }); return true; }
  catch { return false; }
}
const READY = has('command -v soffice') && has('python3 -c "import uno"');

const DIR = '/tmp/lo-password';
const PW = 'geheim123';
const TEXT = 'Ein Satz hinter Schloss und Riegel';
const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: TEXT }] }] };

// Runs LibreOffice on the file; the text it reads back comes out on stdout.
function libreOffice(args: string[]): string {
  return execFileSync('python3', ['tests/lo/password.py', ...args], {
    encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe.skipIf(!READY)('password protection against LibreOffice (needs soffice + python3-uno)', () => {
  it('opens our encrypted .odt', { timeout: 180000 }, async () => {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(`${DIR}/ours.odt`, await encryptOdf(await buildOdt(doc), PW));
    expect(libreOffice(['--in', `${DIR}/ours.odt`, '--password', PW])).toContain(TEXT);
  });

  it('opens our encrypted .docx', { timeout: 180000 }, async () => {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(`${DIR}/ours.docx`, await encryptOoxml(await buildDocx(doc), PW));
    expect(libreOffice(['--in', `${DIR}/ours.docx`, '--password', PW])).toContain(TEXT);
  });

  it('refuses our encrypted .odt with the wrong password', { timeout: 180000 }, async () => {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(`${DIR}/ours.odt`, await encryptOdf(await buildOdt(doc), PW));
    expect(() => libreOffice(['--in', `${DIR}/ours.odt`, '--password', 'falsch'])).toThrow();
  });

  it('reads the .odt LibreOffice encrypts', { timeout: 180000 }, async () => {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(`${DIR}/plain.odt`, await buildOdt(doc));
    libreOffice(['--in', `${DIR}/plain.odt`, '--out', `${DIR}/lo.odt`,
      '--filter', 'writer8', '--store-password', PW]);
    const plain = await decryptOdf(new Uint8Array(readFileSync(`${DIR}/lo.odt`)), PW);
    expect(JSON.stringify(importOdt(plain).content)).toContain(TEXT);
  });

  it('reads the .docx LibreOffice encrypts', { timeout: 180000 }, async () => {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(`${DIR}/plain.odt`, await buildOdt(doc));
    libreOffice(['--in', `${DIR}/plain.odt`, '--out', `${DIR}/lo.docx`,
      '--filter', 'MS Word 2007 XML', '--store-password', PW]);
    const plain = await decryptOoxml(new Uint8Array(readFileSync(`${DIR}/lo.docx`)), PW);
    expect(JSON.stringify(importDocx(plain).content)).toContain(TEXT);
  });
});
