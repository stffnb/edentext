import { describe, it, expect } from 'vitest';
import { displayableImageMime, imageDataUrl, imageExtOf, isConvertibleImage } from '../../src/lib/import/imageFormats';

const bytesOf = (...b: number[]) => new Uint8Array(b);
const PNG = bytesOf(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0);
const JPEG = bytesOf(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0);
const BMP = bytesOf(0x42, 0x4d, 0, 0, 0, 0, 0, 0);
const SVM = bytesOf(0x56, 0x43, 0x4c, 0x4d, 0x54, 0x46, 1, 0); // "VCLMTF"
const TIFF = bytesOf(0x49, 0x49, 0x2a, 0x00, 0, 0, 0, 0);
const WEBP = bytesOf(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);

describe('imageExtOf', () => {
  it('lowercases and strips query/fragment', () => {
    expect(imageExtOf('Pictures/A.PNG')).toBe('png');
    expect(imageExtOf('word/media/image1.jpeg?x=1')).toBe('jpeg');
    expect(imageExtOf('noext')).toBe('noext');
  });
});

describe('displayableImageMime', () => {
  it('resolves renderable formats by extension', () => {
    expect(displayableImageMime(PNG, 'a.png')).toBe('image/png');
    expect(displayableImageMime(JPEG, 'a.jfif')).toBe('image/jpeg');
    expect(displayableImageMime(new Uint8Array(4), 'a.avif')).toBe('image/avif');
  });
  it('returns null for formats the browser cannot display', () => {
    expect(displayableImageMime(SVM, 'a.svm')).toBeNull();
    expect(displayableImageMime(TIFF, 'a.tiff')).toBeNull();
    expect(displayableImageMime(bytesOf(0,0,0,0), 'a.wmf')).toBeNull();
    expect(displayableImageMime(bytesOf(0,0,0,0), 'a.emf')).toBeNull();
  });
  it('recovers a renderable format from magic bytes when the extension is unknown', () => {
    expect(displayableImageMime(PNG, 'blob')).toBe('image/png');
    expect(displayableImageMime(BMP, 'Pictures/x')).toBe('image/bmp');
    expect(displayableImageMime(WEBP, 'x')).toBe('image/webp');
  });
  it('does not mislabel a metafile as a bitmap when the extension is unknown', () => {
    expect(displayableImageMime(SVM, 'Pictures/x')).toBeNull();
  });
});

const TIFF_LE = bytesOf(0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0);
const TIFF_BE = bytesOf(0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8);

describe('isConvertibleImage', () => {
  it('flags TIFF (by extension or magic) as client-side convertible', () => {
    expect(isConvertibleImage(TIFF_LE, 'scan.tiff')).toBe(true);
    expect(isConvertibleImage(TIFF_BE, 'scan.tif')).toBe(true);
    expect(isConvertibleImage(TIFF_LE, 'noext')).toBe(true); // magic-byte fallback
  });
  it('does not flag renderable or truly-unsupported formats', () => {
    expect(isConvertibleImage(PNG, 'a.png')).toBe(false); // already displayable
    expect(isConvertibleImage(SVM, 'a.svm')).toBe(false); // no client-side decoder
    expect(isConvertibleImage(bytesOf(0, 0, 0, 0), 'a.wmf')).toBe(false);
  });
});

describe('imageDataUrl', () => {
  it('emits a data-URI for renderable bytes, null otherwise', () => {
    expect(imageDataUrl(PNG, 'a.png')).toMatch(/^data:image\/png;base64,/);
    expect(imageDataUrl(SVM, 'a.svm')).toBeNull();
  });
});
