import type { GameState } from '../game/sim/types';

export class PatrolOverlay {
  private lastSignature = '';
  constructor(
    private readonly root: HTMLElement,
    private readonly onBegin: () => void,
    private readonly onRestart: () => void,
  ) {
    this.root.addEventListener('click', (event) => {
      const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset
        .action;
      if (action === 'begin') this.onBegin();
      if (action === 'restart') this.onRestart();
    });
  }

  render(game: GameState): void {
    const signature = `${game.phase}:${game.stats.score}:${game.stats.shipsSunk}`;
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    if (game.phase === 'menu') {
      this.root.hidden = false;
      this.root.innerHTML = `<section class="patrol-card"><div class="hud-sub">SILENT DEPTHS · PATROL 003</div><h1>FIRST PATROL</h1><p>Plot a course, acquire the lone freighter, and fire one Mk-14.</p><button class="btn primary" data-action="begin">Begin Patrol</button></section>`;
      return;
    }
    if (game.phase === 'victory' || game.phase === 'gameover') {
      this.root.hidden = false;
      this.root.innerHTML = `<section class="patrol-card"><div class="hud-sub">PATROL RESULT</div><h1>${game.phase === 'victory' ? 'FREIGHTER SUNK' : 'PATROL ENDED'}</h1><p>Score ${game.stats.score} · Ships sunk ${game.stats.shipsSunk}</p><button class="btn primary" data-action="restart">Restart</button></section>`;
      return;
    }
    this.root.hidden = true;
    this.root.innerHTML = '';
  }
}
