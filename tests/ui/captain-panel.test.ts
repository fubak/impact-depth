import { describe, expect, it } from 'vitest';
import { COMBO_WINDOW } from '../../src/game/sim/combo';
import { createGame, startMission } from '../../src/game/sim/api';
import { xpToNext } from '../../src/game/sim/progression';
import {
  bonusScoreLabel,
  buildCaptainView,
  comboBarFraction,
  comboLabel,
  patchCaptainPanel,
  perkChipLabels,
  renderCaptainPanel,
  ultimateFraction,
  ultimateLabel,
  xpBarFraction,
} from '../../src/ui/captain-panel';

const stats = (over: Partial<Record<string, number>> = {}) => ({
  xp: 0,
  level: 1,
  combo: 0,
  comboExpires: 0,
  bonusScore: 0,
  ...over,
});

describe('xpBarFraction', () => {
  it('is zero at the start of a level', () => {
    expect(xpBarFraction(stats())).toBe(0);
  });

  it('is the share of the current level requirement', () => {
    expect(xpBarFraction(stats({ xp: 40, level: 1 }))).toBeCloseTo(40 / xpToNext(1), 6);
    expect(xpBarFraction(stats({ xp: 70, level: 2 }))).toBeCloseTo(70 / xpToNext(2), 6);
  });

  it('clamps to 0..1 for stale or overflowing values', () => {
    expect(xpBarFraction(stats({ xp: 9999, level: 1 }))).toBe(1);
    expect(xpBarFraction(stats({ xp: -5, level: 1 }))).toBe(0);
  });
});

describe('combo view', () => {
  it('shows nothing without an active streak', () => {
    expect(comboLabel(stats({ combo: 0 }), 10)).toBe('');
    expect(comboBarFraction(stats({ combo: 0 }), 10)).toBe(0);
  });

  it('shows nothing for a single kill (no streak bonus yet)', () => {
    expect(comboLabel(stats({ combo: 1, comboExpires: 30 }), 20)).toBe('');
  });

  it('labels an active streak', () => {
    expect(comboLabel(stats({ combo: 3, comboExpires: 30 }), 20)).toBe('x3 STREAK');
    expect(comboLabel(stats({ combo: 2, comboExpires: 30 }), 30)).toBe('x2 STREAK');
  });

  it('clears the label once the window has passed', () => {
    expect(comboLabel(stats({ combo: 4, comboExpires: 30 }), 30.01)).toBe('');
    expect(comboBarFraction(stats({ combo: 4, comboExpires: 30 }), 31)).toBe(0);
  });

  it('drains the expiry bar across the combo window', () => {
    const s = stats({ combo: 3, comboExpires: 100 });
    expect(comboBarFraction(s, 100 - COMBO_WINDOW)).toBe(1);
    expect(comboBarFraction(s, 100 - COMBO_WINDOW / 2)).toBeCloseTo(0.5, 6);
    expect(comboBarFraction(s, 100)).toBe(0);
    expect(comboBarFraction(s, 50)).toBe(1);
  });
});

describe('ultimate view', () => {
  it('reads READY with the key at a full meter', () => {
    expect(ultimateLabel(100)).toBe('BROADSIDE READY · U');
    expect(ultimateLabel(140)).toBe('BROADSIDE READY · U');
  });

  it('reads a whole percent below full, never rounding up to 100', () => {
    expect(ultimateLabel(45)).toBe('BROADSIDE 45%');
    expect(ultimateLabel(0)).toBe('BROADSIDE 0%');
    expect(ultimateLabel(99.9)).toBe('BROADSIDE 99%');
    expect(ultimateLabel(-3)).toBe('BROADSIDE 0%');
  });

  it('maps charge to a 0..1 fraction', () => {
    expect(ultimateFraction(0)).toBe(0);
    expect(ultimateFraction(25)).toBe(0.25);
    expect(ultimateFraction(250)).toBe(1);
  });
});

describe('perkChipLabels', () => {
  it('is empty with no perks', () => {
    expect(perkChipLabels([])).toEqual([]);
  });

  it('uses perk names in the order they were taken', () => {
    expect(perkChipLabels(['predator', 'hotTubes'])).toEqual(['Predator', 'Hot Tubes']);
  });

  it('collapses stacked perks into one chip with a count', () => {
    expect(perkChipLabels(['ironHull', 'predator', 'ironHull'])).toEqual([
      'Iron Hull x2',
      'Predator',
    ]);
  });
});

describe('bonusScoreLabel', () => {
  it('shows +N only when there is a bonus', () => {
    expect(bonusScoreLabel(0)).toBe('');
    expect(bonusScoreLabel(150)).toBe('+150');
    expect(bonusScoreLabel(12.4)).toBe('+12');
  });
});

describe('buildCaptainView / renderCaptainPanel', () => {
  const base = startMission(createGame(7));

  it('describes a fresh captain', () => {
    const view = buildCaptainView(base);
    expect(view.levelLabel).toBe('LV 1');
    expect(view.xpFraction).toBe(0);
    expect(view.xpLabel).toBe(`0/${xpToNext(1)}`);
    expect(view.comboLabel).toBe('');
    expect(view.ultimateLabel).toBe('BROADSIDE 0%');
    expect(view.chips).toEqual([]);
    expect(view.perkHint).toBe('');
  });

  it('flags a pending level-up so a deferred card can be reopened', () => {
    const view = buildCaptainView({ ...base, pendingPerks: ['predator', 'ghost', 'salvage'] });
    expect(view.perkHint).toBe('LEVEL UP · L');
  });

  it('renders every live field and keeps layout stable without a streak', () => {
    const html = renderCaptainPanel(
      buildCaptainView({
        ...base,
        ultimateCharge: 100,
        perks: ['predator'],
        stats: { ...base.stats, level: 3, xp: 50, combo: 2, comboExpires: base.time + 6 },
      }),
    );
    expect(html).toContain('data-field="cap-level"');
    expect(html).toContain('LV 3');
    expect(html).toContain('data-field="cap-xp-bar"');
    expect(html).toContain('x2 STREAK');
    expect(html).toContain('BROADSIDE READY · U');
    expect(html).toContain('Predator');
    const idle = renderCaptainPanel(buildCaptainView(base));
    expect(idle).toContain('data-field="cap-combo"');
    expect(idle).not.toContain('STREAK');
  });
});

describe('patchCaptainPanel', () => {
  const makeEl = () => ({
    textContent: '',
    className: '',
    innerHTML: '',
    style: { width: '' } as Record<string, string>,
    attrs: {} as Record<string, string>,
    setAttribute(name: string, value: string) {
      this.attrs[name] = value;
    },
  });

  it('updates text, bar widths and state classes in place', () => {
    const els: Record<string, ReturnType<typeof makeEl>> = {};
    const root = {
      querySelector: (selector: string) => {
        const field = /data-field="([^"]+)"/.exec(selector)?.[1] ?? '';
        return (els[field] ??= makeEl());
      },
    };
    const base = startMission(createGame(7));
    patchCaptainPanel(
      root as unknown as ParentNode,
      buildCaptainView({
        ...base,
        ultimateCharge: 100,
        perks: ['ghost'],
        stats: { ...base.stats, level: 2, xp: 70, combo: 3, comboExpires: base.time + 12 },
      }),
    );
    expect(els['cap-level']!.textContent).toBe('LV 2');
    expect(els['cap-xp-bar']!.style.width).toBe(`${((70 / xpToNext(2)) * 100).toFixed(1)}%`);
    expect(els['cap-combo']!.textContent).toBe('x3 STREAK');
    expect(els['cap-combo-bar']!.style.width).toBe('100.0%');
    expect(els['cap-ult']!.textContent).toBe('BROADSIDE READY · U');
    expect(els['cap-ult-row']!.className).toContain('is-ready');
    expect(els['cap-chips']!.innerHTML).toContain('Ghost');
  });

  it('tolerates a missing panel', () => {
    const root = { querySelector: () => null };
    expect(() =>
      patchCaptainPanel(
        root as unknown as ParentNode,
        buildCaptainView(startMission(createGame(7))),
      ),
    ).not.toThrow();
  });
});
