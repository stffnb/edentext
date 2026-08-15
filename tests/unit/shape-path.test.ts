// A freeform outline crossing the four path dialects: SVG (ODF's draw:path), VML
// (LibreOffice's own .docx filter), ODF's point lists, and DrawingML's custGeom.
import { describe, it, expect } from 'vitest';
import {
  parseSvgPath, parseVmlPath, parseOdfPoints, fitPath, odfEnhancedPath, drawingMlPath,
} from '../../src/lib/utils/shapes';

describe('path parsing', () => {
  it('reads the relative commands LibreOffice writes', () => {
    // The bezier a converted draw:path comes back as, in a 4001×3001 viewBox.
    const cmds = parseSvgPath('M0 0c1000 0 3001 3001 4001 1501l-4001 1500z');
    expect(cmds.map((c) => c.c)).toEqual(['M', 'C', 'L', 'Z']);
    expect(cmds[1].c === 'C' && cmds[1].p).toEqual([1000, 0, 3001, 3001, 4001, 1501]);
    expect(cmds[2].c === 'L' && cmds[2].p).toEqual([0, 3001]);
  });

  it('reads VML, whose cases are the other way round', () => {
    const vml = parseVmlPath('m0,0l4001,1000l2001,3001l0,0e');
    expect(vml.map((c) => c.c)).toEqual(['M', 'L', 'L', 'L']);
    expect(vml[1].c === 'L' && vml[1].p).toEqual([4001, 1000]);
    // `x` closes; `r` is the relative lineto.
    expect(parseVmlPath('m0,0r100,100x').map((c) => c.c)).toEqual(['M', 'L', 'Z']);
    expect(parseVmlPath('m0,0r100,100x')[1]).toEqual({ c: 'L', p: [100, 100] });
  });

  it('closes a polygon and leaves a polyline open', () => {
    expect(parseOdfPoints('0,0 100,50 0,100', true).map((c) => c.c)).toEqual(['M', 'L', 'L', 'Z']);
    expect(parseOdfPoints('0,0 100,50 0,100', false).map((c) => c.c)).toEqual(['M', 'L', 'L']);
  });

  it('raises a quadratic to a cubic and joins an arc', () => {
    expect(parseSvgPath('M0 0Q 0 100 100 100')[1].c).toBe('C');
    expect(parseSvgPath('M0 0A 50 50 0 0 1 100 100')[1]).toEqual({ c: 'L', p: [100, 100] });
  });

  it('takes an implicit repeat as the same command', () => {
    expect(parseSvgPath('M0 0 10 10 20 20').map((c) => c.c)).toEqual(['M', 'L', 'L']);
  });
});

describe('path emitting', () => {
  const box = fitPath(parseOdfPoints('0,0 4000,1000 2000,3000', true), 4000, 3000);

  it('fits an outline into the editor 0…100 box', () => {
    expect(box).toBe('M 0 0 L 100 33.333 L 50 100 Z');
  });

  it('writes ODF enhanced-path in its own 21600 viewBox', () => {
    expect(odfEnhancedPath(box)).toBe('M 0 0 L 21600 7200 L 10800 21600 Z N');
  });

  it('writes a DrawingML path list', () => {
    expect(drawingMlPath(box, 1000, 600)).toBe(
      '<a:path w="1000" h="600"><a:moveTo><a:pt x="0" y="0"/></a:moveTo>'
      + '<a:lnTo><a:pt x="1000" y="200"/></a:lnTo>'
      + '<a:lnTo><a:pt x="500" y="600"/></a:lnTo><a:close/></a:path>');
  });

  it('survives a full turn through both dialects', () => {
    const again = fitPath(parseSvgPath(odfEnhancedPath(box).replace(' N', '')), 21600, 21600);
    expect(again).toBe(box);
  });
});
