import { describe, expect, it } from 'vitest';
import { PERKS } from '../../src/game/sim/perks';
import {
  perkCards,
  perkCardText,
  perkKeyAction,
  renderPerkOverlay,
  resolvePerkOverlay,
} from '../../src/ui/perk-overlay';
import type { PerkId } from '../../src/game/sim/types';

const offer: PerkId[] = ['predator', 'hotTubes', 'ghost'];

describe('perkCardText', () => {
  it('uses the plain-language name and description from PERKS', () => {
    expect(perkCardText('predator')).toEqual({
      name: PERKS.predator.name,
      description: PERKS.predator.description,
    });
  });
});

describe('perkCards', () => {
  it('numbers the cards 1..n in offer order', () => {
    const cards = perkCards(offer);
    expect(cards.map((c) => c.key)).toEqual(['1', '2', '3']);
    expect(cards.map((c) => c.id)).toEqual(offer);
    expect(cards.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(cards[1]!.name).toBe('Hot Tubes');
  });

  it('copes with a short offer', () => {
    expect(perkCards(['ghost'])).toHaveLength(1);
    expect(perkCards([])).toEqual([]);
  });
});

describe('perkKeyAction', () => {
  it('maps 1/2/3 (and the numpad) to a card index', () => {
    expect(perkKeyAction('Digit1', 3)).toEqual({ type: 'choose', index: 0 });
    expect(perkKeyAction('Digit2', 3)).toEqual({ type: 'choose', index: 1 });
    expect(perkKeyAction('Digit3', 3)).toEqual({ type: 'choose', index: 2 });
    expect(perkKeyAction('Numpad2', 3)).toEqual({ type: 'choose', index: 1 });
  });

  it('ignores a number with no card behind it', () => {
    expect(perkKeyAction('Digit3', 2)).toBeNull();
    expect(perkKeyAction('Digit1', 0)).toBeNull();
  });

  it('leaves the other view keys alone', () => {
    for (const code of ['Digit4', 'Digit7', 'Digit0', 'KeyF', 'KeyU']) {
      expect(perkKeyAction(code, 3)).toBeNull();
    }
  });

  it('defers on Escape', () => {
    expect(perkKeyAction('Escape', 3)).toEqual({ type: 'defer' });
  });
});

describe('resolvePerkOverlay', () => {
  const input = {
    phase: 'playing' as const,
    pendingCount: 3,
    level: 2,
    deferredLevel: null as number | null,
    tutorialOpen: false,
  };

  it('opens when an offer is pending and the patrol is playing', () => {
    expect(resolvePerkOverlay(input)).toEqual({ open: true, deferredLevel: null });
  });

  it('stays closed with nothing pending, and forgets any deferral', () => {
    expect(resolvePerkOverlay({ ...input, pendingCount: 0, deferredLevel: 2 })).toEqual({
      open: false,
      deferredLevel: null,
    });
  });

  it('stays closed outside the playing phase', () => {
    for (const phase of ['menu', 'paused', 'gameover', 'victory'] as const) {
      expect(resolvePerkOverlay({ ...input, phase }).open).toBe(false);
    }
  });

  it('stays closed while the tutorial is open', () => {
    expect(resolvePerkOverlay({ ...input, tutorialOpen: true }).open).toBe(false);
  });

  it('stays closed after Esc until the next level-up', () => {
    const deferred = resolvePerkOverlay({ ...input, deferredLevel: 2 });
    expect(deferred).toEqual({ open: false, deferredLevel: 2 });
    const next = resolvePerkOverlay({ ...input, level: 3, deferredLevel: 2 });
    expect(next).toEqual({ open: true, deferredLevel: null });
  });
});

describe('renderPerkOverlay', () => {
  it('renders three keyed buttons with name and description', () => {
    const html = renderPerkOverlay(offer, 4);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('LEVEL 4');
    for (const [i, id] of offer.entries()) {
      expect(html).toContain(`data-perk-index="${i}"`);
      expect(html).toContain(PERKS[id].name);
      expect(html).toContain(PERKS[id].description);
    }
    expect(html).toContain('data-perk-defer');
    expect(html).toContain('Esc');
  });
});
