import { describe, expect, it } from 'vitest';
import { bootProgressLabel, isWebGL2Available, renderWebGlFailureCopy } from '../../src/ui/boot';

describe('boot failure copy', () => {
  it('tells the player to enable hardware acceleration and names supported browsers', () => {
    const copy = renderWebGlFailureCopy();
    const text = `${copy.title}\n${copy.body}`;
    expect(text).toMatch(/hardware acceleration/i);
    expect(text).toMatch(/Chrome/);
    expect(text).toMatch(/Edge/);
    expect(text).toMatch(/Firefox/);
    expect(text).toMatch(/Safari/);
    expect(text.length).toBeGreaterThan(80);
  });
});

describe('boot progress', () => {
  it('reports how much of the fleet has finished loading', () => {
    expect(bootProgressLabel(0, 11)).toBe('Loading fleet assets 0%');
    expect(bootProgressLabel(1, 2)).toBe('Loading fleet assets 50%');
    expect(bootProgressLabel(11, 11)).toBe('Loading fleet assets 100%');
  });
});

describe('WebGL2 probe', () => {
  it('follows the canvas context instead of assuming a GPU', () => {
    expect(isWebGL2Available(() => ({ getContext: () => null }))).toBe(false);
    expect(isWebGL2Available(() => ({ getContext: () => ({}) }))).toBe(true);
  });
});
