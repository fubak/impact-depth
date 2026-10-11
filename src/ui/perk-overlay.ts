import { PERKS } from '../game/sim/perks';
import type { GamePhase, PerkId } from '../game/sim/types';

/**
 * Level-up card. The pure helpers decide what to show and which key does what;
 * `PerkOverlay` is the thin DOM shell the app drives. The sim never waits on this
 * card: it only keeps `pendingPerks` until a choice is made, and the app freezes
 * its own clock while the card is open.
 */

export interface PerkCard {
  index: number;
  /** The number key that picks this card. */
  key: string;
  id: PerkId;
  name: string;
  description: string;
}

/** Plain-language name and effect for one perk. */
export function perkCardText(id: PerkId): { name: string; description: string } {
  const perk = PERKS[id];
  return { name: perk.name, description: perk.description };
}

/** Cards in offer order, keyed 1..n. */
export function perkCards(pending: readonly PerkId[]): PerkCard[] {
  return pending.map((id, index) => ({
    index,
    key: String(index + 1),
    id,
    ...perkCardText(id),
  }));
}

export type PerkKeyAction = { type: 'choose'; index: number } | { type: 'defer' };

const NUMBER_KEY = /^(?:Digit|Numpad)([1-9])$/;

/** What a key does while the card is open. Everything else returns null. */
export function perkKeyAction(code: string, cardCount: number): PerkKeyAction | null {
  if (code === 'Escape') return { type: 'defer' };
  const match = NUMBER_KEY.exec(code);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index < cardCount ? { type: 'choose', index } : null;
}

export interface PerkOverlayInput {
  phase: GamePhase;
  pendingCount: number;
  level: number;
  /** Level at which the player pressed Esc, or null when nothing is deferred. */
  deferredLevel: number | null;
  tutorialOpen: boolean;
}

export interface PerkOverlayState {
  open: boolean;
  deferredLevel: number | null;
}

/**
 * Whether the card is up. Esc defers the offer until the next level-up (the level
 * changes) or until the player asks for it back with L (the app clears the deferral).
 */
export function resolvePerkOverlay(input: PerkOverlayInput): PerkOverlayState {
  const deferredLevel =
    input.pendingCount > 0 && input.deferredLevel === input.level ? input.deferredLevel : null;
  const open =
    input.phase === 'playing' &&
    input.pendingCount > 0 &&
    deferredLevel === null &&
    !input.tutorialOpen;
  return { open, deferredLevel };
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function renderPerkOverlay(pending: readonly PerkId[], level: number): string {
  const cards = perkCards(pending)
    .map(
      (card) =>
        `<button type="button" class="perk-card" data-perk-index="${card.index}" data-perk-id="${card.id}"><span class="perk-key">${card.key}</span><b class="perk-name">${escapeHtml(card.name)}</b><span class="perk-desc">${escapeHtml(card.description)}</span></button>`,
    )
    .join('');
  return `<div class="perk-dialog" role="dialog" aria-modal="true" aria-labelledby="perk-title" tabindex="-1">
      <div class="perk-eyebrow">LEVEL ${level}</div>
      <h2 class="perk-title" id="perk-title">Choose a perk</h2>
      <div class="perk-cards">${cards}</div>
      <div class="perk-foot"><span>Press 1, 2 or 3 · Esc to decide later (L brings it back)</span><button type="button" class="perk-later" data-perk-defer>Decide later</button></div>
    </div>`;
}

export interface PerkOverlayCallbacks {
  choose: (index: number) => void;
  defer: () => void;
}

export class PerkOverlay {
  private open = false;
  private signature = '';
  private cardCount = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly cb: PerkOverlayCallbacks,
  ) {
    root.hidden = true;
    root.addEventListener('click', this.onClick);
    // Capture phase: while the card is open it owns the keyboard, so 1/2/3 pick a perk
    // instead of switching camera views and nothing else reaches the helm or weapons.
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  isOpen(): boolean {
    return this.open;
  }

  show(pending: readonly PerkId[], level: number): void {
    const signature = `${level}:${pending.join(',')}`;
    this.cardCount = pending.length;
    if (!this.open || signature !== this.signature) {
      this.signature = signature;
      this.root.innerHTML = renderPerkOverlay(pending, level);
    }
    if (!this.open) {
      this.open = true;
      this.root.hidden = false;
      this.root.querySelector<HTMLElement>('.perk-dialog')?.focus({ preventScroll: true });
    }
  }

  hide(): void {
    if (!this.open && this.root.hidden) return;
    this.open = false;
    this.signature = '';
    this.cardCount = 0;
    this.root.hidden = true;
    this.root.innerHTML = '';
  }

  dispose(): void {
    this.root.removeEventListener('click', this.onClick);
    window.removeEventListener('keydown', this.onKeyDown, true);
  }

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-perk-defer]')) {
      this.cb.defer();
      return;
    }
    const card = target?.closest<HTMLElement>('[data-perk-index]');
    if (card) this.cb.choose(Number(card.dataset.perkIndex));
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.open) return;
    const action = perkKeyAction(event.code, this.cardCount);
    // Keys on a focused card button (Enter/Tab) keep their normal behaviour.
    if (event.code === 'Enter' || event.code === 'Tab') return;
    event.stopImmediatePropagation();
    if (event.repeat) return;
    if (action?.type === 'choose') {
      event.preventDefault();
      this.cb.choose(action.index);
    } else if (action?.type === 'defer') {
      event.preventDefault();
      this.cb.defer();
    } else if (event.code === 'Space') {
      event.preventDefault();
    }
  };
}
