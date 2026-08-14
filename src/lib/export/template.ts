import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

// A template is the document it was built from with one label changed: ODF swaps the
// package's media type (in `mimetype` and in the manifest), OOXML the content type of
// the document part. Both word processors then open it as an untitled copy instead of
// the file itself — which is all a .ott/.dotx is.

const ODT_MIME = 'application/vnd.oasis.opendocument.text';
const OTT_MIME = 'application/vnd.oasis.opendocument.text-template';
const DOCX_MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const DOTX_MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml';

export function odtToOtt(bytes: Uint8Array): Uint8Array {
  const files = unzipSync(bytes);
  files['mimetype'] = strToU8(OTT_MIME);
  const manifest = files['META-INF/manifest.xml'];
  if (manifest) {
    files['META-INF/manifest.xml'] = strToU8(strFromU8(manifest).replace(
      new RegExp(`manifest:media-type="${ODT_MIME}"`, 'g'), `manifest:media-type="${OTT_MIME}"`));
  }
  // The mimetype entry stays first and uncompressed, as in every ODF package.
  const out: Record<string, [Uint8Array, { level: 0 | 6 }]> = { mimetype: [files['mimetype'], { level: 0 }] };
  for (const [path, data] of Object.entries(files)) {
    if (path !== 'mimetype') out[path] = [data, { level: 6 }];
  }
  return zipSync(out);
}

export function docxToDotx(bytes: Uint8Array): Uint8Array {
  const files = unzipSync(bytes);
  const ct = files['[Content_Types].xml'];
  if (ct) files['[Content_Types].xml'] = strToU8(strFromU8(ct).replace(DOCX_MAIN, DOTX_MAIN));
  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}
