import {
  getContrastRatio,
  getRelativeLuminance,
  parseCssColor,
} from './color-math';

describe('color-math', () => {
  describe('parseCssColor', () => {
    it('parses standard hex colors', () => {
      expect(parseCssColor('#ffffff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
      expect(parseCssColor('#000000')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
      expect(parseCssColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
      expect(parseCssColor('#000')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
      expect(parseCssColor('#ff000080')).toEqual({ r: 255, g: 0, b: 0, a: 128 / 255 });
    });

    it('parses rgb and rgba strings', () => {
      expect(parseCssColor('rgb(255, 255, 255)')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
      expect(parseCssColor('rgba(0, 128, 255, 0.5)')).toEqual({ r: 0, g: 128, b: 255, a: 0.5 });
      expect(parseCssColor('rgba(0, 0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    });

    it('parses named colors and transparent', () => {
      expect(parseCssColor('white')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
      expect(parseCssColor('black')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
      expect(parseCssColor('red')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
      expect(parseCssColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    });

    it('returns null for invalid color strings', () => {
      expect(parseCssColor('')).toBeNull();
      expect(parseCssColor('invalid-color-value')).toBeNull();
      expect(parseCssColor(null as unknown as string)).toBeNull();
    });
  });

  describe('getRelativeLuminance', () => {
    it('calculates 1.0 for pure white and 0.0 for pure black', () => {
      expect(getRelativeLuminance(255, 255, 255)).toBeCloseTo(1.0, 4);
      expect(getRelativeLuminance(0, 0, 0)).toBeCloseTo(0.0, 4);
    });

    it('calculates expected luminance for standard sRGB primaries', () => {
      const redLum = getRelativeLuminance(255, 0, 0);
      const greenLum = getRelativeLuminance(0, 255, 0);
      const blueLum = getRelativeLuminance(0, 0, 255);

      expect(redLum).toBeCloseTo(0.2126, 4);
      expect(greenLum).toBeCloseTo(0.7152, 4);
      expect(blueLum).toBeCloseTo(0.0722, 4);
    });
  });

  describe('getContrastRatio', () => {
    it('computes 21:1 for black on white', () => {
      const whiteLum = getRelativeLuminance(255, 255, 255);
      const blackLum = getRelativeLuminance(0, 0, 0);
      expect(getContrastRatio(whiteLum, blackLum)).toBeCloseTo(21.0, 1);
    });

    it('computes 1:1 for identical colors', () => {
      const grayLum = getRelativeLuminance(128, 128, 128);
      expect(getContrastRatio(grayLum, grayLum)).toBeCloseTo(1.0, 4);
    });

    it('is commutative (order of arguments does not change ratio)', () => {
      const l1 = getRelativeLuminance(255, 0, 0);
      const l2 = getRelativeLuminance(255, 255, 255);
      expect(getContrastRatio(l1, l2)).toBe(getContrastRatio(l2, l1));
    });
  });
});
