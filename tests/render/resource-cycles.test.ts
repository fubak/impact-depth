import { describe, expect, it } from 'vitest';
import {
  RESOURCE_CYCLE_SLACK_ABS,
  RESOURCE_CYCLE_SLACK_MULTIPLIER,
  checkResourceCycleMonotonicGrowth,
  checkResourceCycleSlack,
  extractResourceCounts,
  resourceCycleSlackLimit,
} from './resource-cycle-policy';

describe('resource-cycle slack policy', () => {
  it('computes limit as baseline * multiplier + absolute headroom', () => {
    expect(resourceCycleSlackLimit(10)).toBe(
      10 * RESOURCE_CYCLE_SLACK_MULTIPLIER + RESOURCE_CYCLE_SLACK_ABS,
    );
    expect(RESOURCE_CYCLE_SLACK_MULTIPLIER).toBe(3);
    expect(RESOURCE_CYCLE_SLACK_ABS).toBe(32);
  });

  it('extracts geometry/texture/program counts from performance probe shape', () => {
    expect(
      extractResourceCounts({
        graphics: { memory: { geometries: 12, textures: 34 }, programs: 56 },
      }),
    ).toEqual({ geometries: 12, textures: 34, programs: 56 });
    expect(extractResourceCounts(null)).toEqual({ geometries: 0, textures: 0, programs: 0 });
  });

  it('passes when post-cycle counts stay within slack', () => {
    const baseline = { geometries: 20, textures: 30, programs: 15 };
    const current = { geometries: 50, textures: 80, programs: 40 };
    expect(checkResourceCycleSlack(baseline, current, 'test')).toEqual([]);
  });

  it('fails when any metric exceeds warmup * 3 + 32', () => {
    const baseline = { geometries: 20, textures: 30, programs: 15 };
    const current = { geometries: 20, textures: 200, programs: 15 };
    const failures = checkResourceCycleSlack(baseline, current, 'cycle-3');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('textures=200');
    expect(failures[0]).toContain(String(resourceCycleSlackLimit(30)));
  });

  it('flags strict monotonic growth across every cycle', () => {
    const samples = [
      { geometries: 1, textures: 1, programs: 1 },
      { geometries: 2, textures: 2, programs: 2 },
      { geometries: 3, textures: 3, programs: 3 },
      { geometries: 4, textures: 4, programs: 4 },
    ];
    expect(checkResourceCycleMonotonicGrowth(samples, 'leak')).toEqual([
      'leak: geometries strictly increased every cycle (1 → 4)',
      'leak: textures strictly increased every cycle (1 → 4)',
      'leak: programs strictly increased every cycle (1 → 4)',
    ]);
  });

  it('ignores monotonic growth shorter than three samples', () => {
    expect(
      checkResourceCycleMonotonicGrowth(
        [
          { geometries: 1, textures: 1, programs: 1 },
          { geometries: 2, textures: 2, programs: 2 },
        ],
        'short',
      ),
    ).toEqual([]);
  });
});
