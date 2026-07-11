import { describe, it, expect } from 'vitest';
import { stripOdtExtension } from '../../src/lib/storage/documentName';

describe('stripOdtExtension', () => {
  it('drops a trailing .odt or .ott (case-insensitive)', () => {
    expect(stripOdtExtension('Foo.odt')).toBe('Foo');
    expect(stripOdtExtension('Foo.ott')).toBe('Foo');
    expect(stripOdtExtension('Report.ODT')).toBe('Report');
    expect(stripOdtExtension('Report.OTT')).toBe('Report');
  });

  it('leaves other names and extensions untouched', () => {
    expect(stripOdtExtension('Foo.docx')).toBe('Foo.docx');
    expect(stripOdtExtension('my.odt.notes')).toBe('my.odt.notes');
    expect(stripOdtExtension('plain')).toBe('plain');
  });
});
