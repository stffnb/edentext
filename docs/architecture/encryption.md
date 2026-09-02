# Password protection

`src/lib/crypto/` encrypts the saved file and decrypts an opened one. Everything below was
probed against LibreOffice 25.2 rather than read off a specification — the two places where
the file alone does not say what happens are marked.

- `protect.ts` — the only module the app and `export/saveFile.ts` import. `isProtected`,
  `encryptPackage`, `decryptPackage`; it sniffs the container and `await import`s the
  format module, so neither `@noble/hashes` nor `@noble/ciphers` enters the main bundle.
- `odf.ts`, `ooxml.ts`, `cfb.ts` (the compound file OOXML encryption is wrapped in),
  `errors.ts` (the two canonical messages, matched by `i18n/importMessages.ts`).

Crypto comes from `@noble/*` except PBKDF2, which WebCrypto does natively and much faster.

## Where it sits

Encryption is the **last** thing to touch the bytes: `writeHandle`/`download` in
`export/saveFile.ts`, after every post-processing pass and after `template.ts` has turned an
.odt into an .ott. Decryption is the **first**: the top of `applyImport` in `App.svelte`,
before `convertUnsupportedImages`, which would otherwise unzip an encrypted archive and find
nothing. The password lives in `docPassword` for the session only — the autosaved copy in
localStorage stays plain text, as both reference word processors' recovery copies do.

## ODF

**What we write** (LibreOffice's default since 24.8, "wholesome" encryption): three entries —
`mimetype` (stored, plain, first), `encrypted-package`, `META-INF/manifest.xml` (plain).
The whole inner package is raw-deflated, then AES-256-GCM encrypted; the entry is
`IV ‖ ciphertext ‖ tag`. **The repeated 12-byte nonce ahead of the ciphertext appears in no
manifest** — it comes from LibreOffice's NSS cipher context, which compares it on reading.
Key: `argon2id(SHA-256(password), salt, t=3, m=64 MiB, p=4) → 32 bytes`. There is no
checksum; the GCM tag is the password check.

**What we also read**: the per-entry form of ODF 1.2/1.3. Each entry except `mimetype` and
the manifest is raw-deflated, then AES-256-CBC with W3C padding (the last byte counts the
added bytes), stored. Key: `PBKDF2(SHA-256(password), salt, iterations, 32)` **with
HMAC-SHA-1 as the PRF**. `manifest:checksum` is SHA-256 over the first 1024 bytes of the
decrypted, still deflated stream — the wrong-password test. LibreOffice writes 100000
iterations per entry, and 600000 for a whole-package document.

Blowfish CFB (OpenOffice ≤ 2.x) is refused with `UNSUPPORTED_ENCRYPTION`.

The CRC32 in the zip entry of an encrypted stream covers the **ciphertext**, so `fflate`'s
`zipSync(..., { level: 0 })` writes exactly what LibreOffice does — no own zip writer needed.

## OOXML

An encrypted .docx is not a zip: it is a compound file holding `EncryptionInfo` and
`EncryptedPackage`. `cfb.ts` writes and reads that container, MiniFAT included —
`EncryptionInfo` is a few hundred bytes and therefore lives in the mini stream.

**What we write**: agile encryption (EncryptionInfo 4.4) with Word's own parameters —
spinCount 100000, SHA-512, AES-256-CBC, 16-byte blocks and salts, `dataIntegrity` HMAC.
The package is encrypted in 4096-byte segments, each under `H(keySalt ‖ LE32(index))`, behind
an 8-byte plain length.

**What we also read**: standard encryption (3.2), which LibreOffice writes — one AES-**ECB**
key from 50000 SHA-1 rounds, password checked against the verifier. RC4 and XOR are refused.

**LibreOffice writes no `\x06DataSpaces` streams and we write none either.** LibreOffice
opens ours; that Word does too is the one claim here not verified in this container.

## Verifying

`npm run test:lo` includes `tests/lo-password.test.ts`: LibreOffice opens our encrypted .odt
and .docx, refuses ours with a wrong password, and we read back what it encrypts in both
formats. It drives LibreOffice through `tests/lo/password.py` (UNO — `--convert-to` cannot
pass a password) and self-skips without `soffice` or `python3-uno`. The unit tests in
`tests/unit/{odf,ooxml}-encryption.test.ts` and `cfb-container.test.ts` need neither.
