import type { GameState } from '../game/sim/types';

export class PatrolOverlay {
  private lastSignature = '';
  constructor(
    private readonly root: HTMLElement,
    private readonly onBegin: () => void,
    private readonly onRestart: () => void,
    private readonly onMenu?: (action: 'begin' | 'strike' | 'new-seed' | 'retry') => void,
  ) {
    this.root.addEventListener('click', (event) => {
      const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset
        .action;
      if (
        action === 'begin' ||
        action === 'strike' ||
        action === 'new-seed' ||
        action === 'retry'
      ) {
        if (this.onMenu) this.onMenu(action);
        else if (action === 'begin') this.onBegin();
        return;
      }
      if (action === 'restart') this.onRestart();
    });
  }

  render(game: GameState): void {
    const signature = `${game.phase}:${game.stats.score}:${game.stats.shipsSunk}`;
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    if (game.phase === 'menu') {
      this.root.hidden = false;
      this.root.innerHTML = `<section class="patrol-card"><div class="hud-sub">SILENT DEPTHS</div><h1>BEGIN PATROL</h1><p>Clear two waves, or strike one merchant and leave.</p><button class="btn primary" data-action="begin">Begin Patrol</button><button class="btn" data-action="strike">Convoy strike</button><button class="btn" data-action="new-seed">New patrol seed</button><button class="btn" data-action="retry">Retry same seed</button></section>`;
      return;
    }
    if (game.phase === 'victory' || game.phase === 'gameover') {
      this.root.hidden = false;
      const strike = game.scenario === 'convoy-strike';
      const goal = strike
        ? game.phase === 'victory'
          ? 'Merchant sunk'
          : 'Merchant escaped'
        : 'Clear two waves';
      const cause =
        game.submarine.lastDamage === 'ground'
          ? 'Grounded'
          : game.submarine.lastDamage === 'weapon'
            ? 'Weapon hit'
            : '';
      this.root.innerHTML = `<section class="patrol-card"><div class="hud-sub">PATROL RESULT</div><h1>${game.phase === 'victory' ? 'SECTOR CLEARED' : 'PATROL ENDED'}</h1><p>${goal}</p><p>Score ${game.stats.score} · Ships sunk ${game.stats.shipsSunk}${cause ? ` · ${cause}` : ''}</p><button class="btn primary" data-action="restart">Restart</button></section>`;
      return;
    }
    this.root.hidden = true;
    this.root.innerHTML = '';
  }
}
