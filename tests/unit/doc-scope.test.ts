import { describe, it, expect } from 'vitest';
import { pickSlot } from '../../src/lib/storage/docScope';

const NOW = 1_700_000_000_000;
const MIN = 60_000;

describe('pickSlot', () => {
  it('gives the first tab of any browser the unsuffixed slot', () => {
    expect(pickSlot({}, NOW)).toBe('');
  });

  it('mints a new document while every one is held', () => {
    const id = pickSlot({ '': NOW - 1000 }, NOW);
    expect(id).not.toBe('');
    expect(pickSlot({ '': NOW - 1000, [id]: NOW }, NOW)).not.toBe(id);
  });

  it('takes up the most recent document no tab holds', () => {
    // Negative = a tab signed off; the stamp still says how recently it was used.
    expect(pickSlot({ '': -(NOW - 9 * MIN), d2: -(NOW - 2 * MIN) }, NOW)).toBe('d2');
  });

  it('counts a marker nobody has refreshed in ten minutes as abandoned', () => {
    expect(pickSlot({ '': NOW - 11 * MIN, d2: NOW - 1 * MIN }, NOW)).toBe('');
  });
});
