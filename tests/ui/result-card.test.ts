import { describe, expect, it } from 'vitest';
import { createConvoyStrike, createGame, startMission } from '../../src/game/sim/api';
import { renderResultCard } from '../../src/ui/overlays';
import { objectiveText } from '../../src/ui/hud';
import type { GameState } from '../../src/game/sim/types';

const patrolVictory = (): GameState => ({
  ...startMission(createGame(21)),
  phase: 'victory',
});

describe('renderResultCard', () => {
  it('shows the sector cleared card with restart and Keep hunting for a patrol victory', () => {
    const html = renderResultCard(patrolVictory());
    expect(html).toContain('SECTOR CLEARED');
    expect(html).toContain('Clear two waves');
    expect(html).toContain('data-action="restart"');
    expect(html).toContain('data-action="endless"');
    expect(html).toContain('Keep hunting');
    expect(html.indexOf('data-action="restart"')).toBeLessThan(
      html.indexOf('data-action="endless"'),
    );
  });

  it('keeps the convoy-strike victory copy and has no endless button', () => {
    const strike = createConvoyStrike(21);
    const html = renderResultCard({ ...strike, phase: 'victory' });
    expect(html).toContain('Merchant sunk');
    expect(html).toContain('data-action="restart"');
    expect(html).not.toContain('data-action="endless"');
  });

  it('leaves a patrol gameover byte-identical to the pre-change markup', () => {
    const base = startMission(createGame(21));
    const state: GameState = {
      ...base,
      phase: 'gameover',
      stats: { ...base.stats, score: 150, shipsSunk: 2 },
      submarine: { ...base.submarine, lastDamage: 'weapon' },
    };
    expect(renderResultCard(state)).toBe(
      '<section class="patrol-card"><div class="hud-sub">PATROL RESULT</div><h1>PATROL ENDED</h1><p>Clear two waves</p><p>Score 150 · Ships sunk 2 · Weapon hit</p><button class="btn primary" data-action="restart">Restart</button></section>',
    );
  });

  it('shows the endless goal line on an endless gameover with no Keep hunting button', () => {
    const base = startMission(createGame(21));
    const state: GameState = {
      ...base,
      phase: 'gameover',
      endless: true,
      stats: { ...base.stats, wave: 5 },
    };
    const html = renderResultCard(state);
    expect(html).toContain('Endless hunt · reached wave 5');
    expect(html).not.toContain('data-action="endless"');
  });

  it('does not offer Keep hunting again once the patrol is already endless', () => {
    const html = renderResultCard({ ...patrolVictory(), endless: true });
    expect(html).not.toContain('data-action="endless"');
    expect(html).toContain('Endless hunt');
  });
});

describe('objectiveText endless', () => {
  it('shows the endless wave on a non-strike endless game', () => {
    expect(
      objectiveText({ scenario: 'patrol', endless: true, stats: { shipsSunk: 9, wave: 4 } }),
    ).toBe('Endless · wave 4');
  });

  it('keeps the clear-two-waves objective when not endless', () => {
    expect(objectiveText()).toBe('Clear two waves');
  });
});
