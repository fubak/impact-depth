import { canContinueEndless } from '../game/sim/endless';
import type { GameState } from '../game/sim/types';
import {
  environmentPatchFromButton,
  renderEnvironmentChoosers,
  syncEnvironmentChoosers,
  type EnvironmentSelection,
} from './environment-panel';

/** Weather and time-of-day choice held by the App and applied to every new game. */
export interface MenuEnvironment {
  get(): EnvironmentSelection;
  change(patch: Partial<EnvironmentSelection>): void;
}

/** Victory or gameover result card. Plan 030: "Keep hunting" only after a finished, non-endless patrol. */
export function renderResultCard(game: GameState): string {
  const strike = game.scenario === 'convoy-strike';
  const goal = strike
    ? game.phase === 'victory'
      ? 'Merchant sunk'
      : 'Merchant escaped'
    : game.endless === true
      ? `Endless hunt · reached wave ${game.stats.wave}`
      : 'Clear two waves';
  const cause =
    game.submarine.lastDamage === 'ground'
      ? 'Grounded'
      : game.submarine.lastDamage === 'weapon'
        ? 'Weapon hit'
        : '';
  const keepHunting = canContinueEndless(game)
    ? '<button class="btn" data-action="endless">Keep hunting</button>'
    : '';
  return `<section class="patrol-card"><div class="hud-sub">PATROL RESULT</div><h1>${game.phase === 'victory' ? 'SECTOR CLEARED' : 'PATROL ENDED'}</h1><p>${goal}</p><p>Score ${game.stats.score} · Ships sunk ${game.stats.shipsSunk}${cause ? ` · ${cause}` : ''}</p><button class="btn primary" data-action="restart">Restart</button>${keepHunting}</section>`;
}

export class PatrolOverlay {
  private lastSignature = '';
  constructor(
    private readonly root: HTMLElement,
    private readonly onBegin: () => void,
    private readonly onRestart: () => void,
    private readonly onMenu?: (action: 'begin' | 'strike' | 'new-seed' | 'retry') => void,
    private readonly environment?: MenuEnvironment,
    private readonly onEndless?: () => void,
  ) {
    this.root.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      const patch = environmentPatchFromButton(button);
      if (patch && this.environment) {
        this.environment.change(patch);
        this.syncEnvironment();
        return;
      }
      const action = button?.dataset.action;
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
      if (action === 'endless') {
        this.onEndless?.();
        return;
      }
      if (action === 'restart') this.onRestart();
    });
  }

  /** Reflect the held choice in the menu card's weather and time buttons. */
  syncEnvironment(): void {
    if (this.environment) syncEnvironmentChoosers(this.root, this.environment.get());
  }

  render(game: GameState): void {
    const signature = `${game.phase}:${game.stats.score}:${game.stats.shipsSunk}`;
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    if (game.phase === 'menu') {
      this.root.hidden = false;
      this.root.innerHTML = `<section class="patrol-card"><div class="hud-sub">SILENT DEPTHS</div><h1>BEGIN PATROL</h1><p>Clear two waves, or strike one merchant and leave.</p><button class="btn primary" data-action="begin">Begin Patrol</button><button class="btn" data-action="strike">Convoy strike</button><button class="btn" data-action="new-seed">New patrol seed</button><button class="btn" data-action="retry">Retry same seed</button>${this.environment ? `<div class="env-choosers" aria-label="Weather and time of day">${renderEnvironmentChoosers(this.environment.get())}</div>` : ''}</section>`;
      return;
    }
    if (game.phase === 'victory' || game.phase === 'gameover') {
      this.root.hidden = false;
      this.root.innerHTML = renderResultCard(game);
      return;
    }
    this.root.hidden = true;
    this.root.innerHTML = '';
  }
}
