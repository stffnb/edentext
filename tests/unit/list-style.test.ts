import { describe, it, expect } from 'vitest';
import {
  builtinListStyles, effectiveListLevel, listStyleMarginCm, listStyleOverridden,
  MAX_LIST_LEVELS, type ListStyle,
} from '../../src/lib/styles/listStyles';

const style: ListStyle = {
  name: 'Test',
  levels: [
    { kind: 'number', numType: 'upper-roman-paren', markerAlign: 'right', indentCm: 0.5 },
    { kind: 'bullet', bulletChar: '✓' },
    { kind: 'number', numType: 'lower-alpha', startAt: 3 },
  ],
};

describe('effectiveListLevel (attr ?? style level ?? cycle default)', () => {
  it('takes the style level where the node has no attr', () => {
    const eff = effectiveListLevel({}, true, style, 1);
    expect(eff.listStyleType).toBe('upper-roman-paren');
    expect(eff.markerAlign).toBe('right');
    expect(eff.indent).toBe(0.5);
  });

  it('lets a node attr override its level', () => {
    const eff = effectiveListLevel({ listStyleType: 'decimal', indent: 1 }, true, style, 1);
    expect(eff.listStyleType).toBe('decimal');
    expect(eff.indent).toBe(1);
    expect(eff.markerAlign).toBe('right'); // untouched channel still comes from the style
  });

  it('the level kind wins over the node species (a number level numbers a <ul>)', () => {
    expect(effectiveListLevel({}, false, style, 2).bulletChar).toBe('✓');
    // An ordered node over the bullet level renders that bullet, not a numbering.
    const overBullet = effectiveListLevel({}, true, style, 2);
    expect(overBullet.kind).toBe('bullet');
    expect(overBullet.bulletChar).toBe('✓');
    expect(overBullet.listStyleType).toBeNull();
    // A bullet node over a number level renders the numbering — start value included.
    const overNumber = effectiveListLevel({}, false, style, 1);
    expect(overNumber.kind).toBe('number');
    expect(overNumber.listStyleType).toBe('upper-roman-paren');
    expect(overNumber.bulletChar).toBeNull();
    expect(effectiveListLevel({}, false, style, 3).startAt).toBe(3);
  });

  it('a sparse level still names its marker, as the manager preview shows it', () => {
    const sparse: ListStyle = { name: 'S', levels: [{ kind: 'bullet' }, { kind: 'number' }] };
    expect(effectiveListLevel({}, false, sparse, 1).bulletChar).toBe('•');
    expect(effectiveListLevel({}, true, sparse, 2).listStyleType).toBe('decimal');
  });

  it('a node marker attr keeps its own species over the level', () => {
    expect(effectiveListLevel({ bulletChar: '❖' }, false, style, 1)).toMatchObject({ kind: 'bullet', bulletChar: '❖' });
    expect(effectiveListLevel({ listStyleType: 'decimal' }, true, style, 2)).toMatchObject({ kind: 'number', listStyleType: 'decimal' });
  });

  it('falls back to the cycle default past the defined levels and without a style', () => {
    expect(effectiveListLevel({}, true, style, 5).listStyleType).toBeNull();
    expect(effectiveListLevel({}, true, null, 1).listStyleType).toBeNull();
  });

  it('a multilevel style renders the chain on every ordered level', () => {
    const ml: ListStyle = { name: 'ML', multilevel: true, levels: [{ kind: 'number', numType: 'decimal' }] };
    expect(effectiveListLevel({}, true, ml, 1).listStyleType).toBe('multilevel');
    expect(effectiveListLevel({}, true, ml, 3).listStyleType).toBe('multilevel');
  });

  it('carries the level start value for the matching kind', () => {
    expect(effectiveListLevel({}, true, style, 3).startAt).toBe(3);
    expect(effectiveListLevel({}, false, style, 2).startAt).toBeNull();
  });
});

describe('listStyleOverridden', () => {
  const li = (...c: unknown[]) => ({ type: 'listItem', content: [{ type: 'paragraph' }, ...c] });
  it('a clean subtree is not overridden; `start` is content, not formatting', () => {
    expect(listStyleOverridden({ type: 'orderedList', attrs: { listStyleName: 'Test', start: 4 }, content: [li()] })).toBe(false);
  });
  it('any marker/indent attr anywhere in the subtree overrides', () => {
    expect(listStyleOverridden({ type: 'orderedList', attrs: { listStyleType: 'decimal' }, content: [li()] })).toBe(true);
    expect(listStyleOverridden({
      type: 'orderedList', content: [li({ type: 'bulletList', attrs: { bulletChar: '❖' }, content: [li()] })],
    })).toBe(true);
    expect(listStyleOverridden({ type: 'bulletList', attrs: { indent: 1.5 }, content: [li()] })).toBe(true);
  });
});

describe('the built-ins (the preset gallery)', () => {
  const builtins = builtinListStyles();
  it('ship five presets, ten levels each, none uniform across its levels', () => {
    expect(Object.keys(builtins).sort()).toEqual(
      ['Checklist', 'Diamond Bullets', 'Numbering with Bullets', 'Outline A.I.1', 'Outline I.A.1']);
    for (const s of Object.values(builtins)) {
      expect(s.levels).toHaveLength(MAX_LIST_LEVELS);
      const markers = new Set(s.levels.map((l) => `${l.kind}:${l.bulletChar ?? l.numType}`));
      expect(markers.size, `${s.name} must differ across levels`).toBeGreaterThan(1);
    }
  });
  it('keep the plain 1.27cm step per level', () => {
    expect(listStyleMarginCm(builtins['Outline I.A.1'], 1)).toBeCloseTo(1.27, 3);
    expect(listStyleMarginCm(builtins['Diamond Bullets'], 3)).toBeCloseTo(3.81, 3);
  });
  it('Outline I.A.1 runs I. A. 1. a) i) with the wide roman labels right-set', () => {
    expect(builtins['Outline I.A.1'].levels.slice(0, 5).map((l) => l.numType)).toEqual(
      ['upper-roman', 'upper-alpha', 'decimal', 'lower-alpha-paren', 'lower-roman-paren']);
    expect(builtins['Outline I.A.1'].levels[0].markerAlign).toBe('right');
  });
  it('Numbering with Bullets numbers level 1 and dashes the levels below', () => {
    expect(builtins['Numbering with Bullets'].levels[0]).toMatchObject({ kind: 'number', numType: 'decimal' });
    expect(builtins['Numbering with Bullets'].levels[1]).toMatchObject({ kind: 'bullet', bulletChar: '–' });
    expect(builtins['Checklist'].levels[0]).toMatchObject({ kind: 'bullet', bulletChar: '✓' });
  });
});
