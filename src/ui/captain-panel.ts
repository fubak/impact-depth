import { COMBO_WINDOW } from '../game/sim/combo';
import { PERKS } from '../game/sim/perks';
import { xpToNext } from '../game/sim/progression';
import { ULTIMATE_MAX } from '../game/sim/ultimate';
import type { GameState, GameStats, PerkId } from '../game/sim/types';

/**
 * Captain panel: level, XP, kill streak, Broadside meter and owned perks.
 * Everything above `renderCaptainPanel` is a pure view-model so it can be unit tested;
 * the HUD only places the markup inside its score block and patches it each frame.
 */

/** A streak needs at least two kills before it earns a bonus, so it is shown from there. */
const MIN_VISIBLE_STREAK = 2;
/** Chips that fit on the single chip line; the rest collapse into "+N". */
const MAX_CHIPS = 4;
const NO_STREAK_TEXT = 'No streak';

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/** Share of the current level's XP requirement already earned. */
export function xpBarFraction(stats: Pick<GameStats, 'xp' | 'level'>): number {
  return clamp01(stats.xp / xpToNext(stats.level));
}

const streakIsLive = (stats: Pick<GameStats, 'combo' | 'comboExpires'>, time: number): boolean =>
  stats.combo >= MIN_VISIBLE_STREAK && time <= stats.comboExpires;

/** "x3 STREAK" while a streak is alive, otherwise an empty string. */
export function comboLabel(stats: Pick<GameStats, 'combo' | 'comboExpires'>, time: number): string {
  return streakIsLive(stats, time) ? `x${stats.combo} STREAK` : '';
}

/** Time left in the streak window as 0..1 (1 right after a kill, 0 when it lapses). */
export function comboBarFraction(
  stats: Pick<GameStats, 'combo' | 'comboExpires'>,
  time: number,
): number {
  return streakIsLive(stats, time) ? clamp01((stats.comboExpires - time) / COMBO_WINDOW) : 0;
}

/** Broadside meter fill as 0..1. */
export const ultimateFraction = (charge: number): number => clamp01(charge / ULTIMATE_MAX);

/** "BROADSIDE READY · U" at a full meter, otherwise "BROADSIDE 45%". */
export function ultimateLabel(charge: number): string {
  if (charge >= ULTIMATE_MAX) return 'BROADSIDE READY · U';
  return `BROADSIDE ${Math.max(0, Math.floor(charge))}%`;
}

/** One chip per perk in the order taken; stacked perks collapse to "Name x2". */
export function perkChipLabels(perks: readonly PerkId[]): string[] {
  const counts = new Map<PerkId, number>();
  for (const id of perks) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].map(([id, count]) =>
    count > 1 ? `${PERKS[id].name} x${count}` : PERKS[id].name,
  );
}

/** "+150" streak bonus shown beside the score, or '' when there is none yet. */
export const bonusScoreLabel = (bonus: number): string =>
  bonus > 0 ? `+${Math.round(bonus)}` : '';

export interface CaptainView {
  levelLabel: string;
  xpFraction: number;
  xpLabel: string;
  comboLabel: string;
  comboFraction: number;
  ultimateLabel: string;
  ultimateFraction: number;
  ultimateReady: boolean;
  chips: string[];
  /** Shown while a level-up card is waiting (for example after Esc). */
  perkHint: string;
  bonusLabel: string;
}

type CaptainSource = Pick<
  GameState,
  'stats' | 'time' | 'ultimateCharge' | 'perks' | 'pendingPerks'
>;

export function buildCaptainView(game: CaptainSource): CaptainView {
  const { stats } = game;
  return {
    levelLabel: `LV ${stats.level}`,
    xpFraction: xpBarFraction(stats),
    xpLabel: `${Math.floor(stats.xp)}/${xpToNext(stats.level)}`,
    comboLabel: comboLabel(stats, game.time),
    comboFraction: comboBarFraction(stats, game.time),
    ultimateLabel: ultimateLabel(game.ultimateCharge),
    ultimateFraction: ultimateFraction(game.ultimateCharge),
    ultimateReady: game.ultimateCharge >= ULTIMATE_MAX,
    chips: perkChipLabels(game.perks),
    perkHint: game.pendingPerks.length > 0 ? 'LEVEL UP · L' : '',
    bonusLabel: bonusScoreLabel(stats.bonusScore),
  };
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);

const widthPercent = (fraction: number): string => `${(fraction * 100).toFixed(1)}%`;

/** Chip line markup: the level-up hint first, then up to MAX_CHIPS perks and a "+N" tail. */
export function chipsMarkup(view: Pick<CaptainView, 'chips' | 'perkHint'>): string {
  const shown = view.chips.slice(0, MAX_CHIPS);
  const hidden = view.chips.length - shown.length;
  const parts = [
    ...(view.perkHint ? [`<em class="cap-hint">${escapeHtml(view.perkHint)}</em>`] : []),
    ...shown.map((label) => `<em class="cap-chip">${escapeHtml(label)}</em>`),
    ...(hidden > 0 ? [`<em class="cap-chip cap-more">+${hidden}</em>`] : []),
  ];
  return parts.join('');
}

const comboRowClass = (view: CaptainView): string =>
  `cap-meter cap-combo${view.comboLabel ? ' is-active' : ''}`;

const ultRowClass = (view: CaptainView): string =>
  `cap-meter cap-ult${view.ultimateReady ? ' is-ready' : ''}`;

/** Panel markup. Uses div/i/em only so the HUD's `.hud-score span` rules do not apply. */
export function renderCaptainPanel(view: CaptainView): string {
  return `<div class="captain-panel" data-captain-panel aria-label="Captain progress" aria-live="off">
        <div class="cap-row">
          <b class="cap-level" data-field="cap-level">${escapeHtml(view.levelLabel)}</b>
          <div class="cap-meter cap-xp" data-field="cap-xp-track" role="progressbar" aria-label="Experience" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(view.xpFraction * 100)}"><i class="cap-fill" data-field="cap-xp-bar" style="width:${widthPercent(view.xpFraction)}"></i><em data-field="cap-xp">${escapeHtml(view.xpLabel)}</em></div>
        </div>
        <div class="${comboRowClass(view)}" data-field="cap-combo-row"><i class="cap-fill" data-field="cap-combo-bar" style="width:${widthPercent(view.comboFraction)}"></i><em data-field="cap-combo">${escapeHtml(view.comboLabel || NO_STREAK_TEXT)}</em></div>
        <div class="${ultRowClass(view)}" data-field="cap-ult-row"><i class="cap-fill" data-field="cap-ult-bar" style="width:${widthPercent(view.ultimateFraction)}"></i><em data-field="cap-ult">${escapeHtml(view.ultimateLabel)}</em></div>
        <div class="cap-chips" data-field="cap-chips">${chipsMarkup(view)}</div>
      </div>`;
}

/** Minimal element surface the patcher touches (keeps it testable without a DOM). */
interface PatchableElement {
  textContent: string | null;
  className: string;
  innerHTML: string;
  style: { width: string };
  setAttribute(name: string, value: string): void;
}

/** Update the markup from `renderCaptainPanel` in place. Missing nodes are skipped. */
export function patchCaptainPanel(root: ParentNode, view: CaptainView): void {
  const find = (field: string): PatchableElement | null =>
    root.querySelector<HTMLElement>(`[data-field="${field}"]`) as PatchableElement | null;
  const text = (field: string, value: string): void => {
    const el = find(field);
    if (el && el.textContent !== value) el.textContent = value;
  };
  const width = (field: string, fraction: number): void => {
    const el = find(field);
    const next = widthPercent(fraction);
    if (el && el.style.width !== next) el.style.width = next;
  };
  const cls = (field: string, value: string): void => {
    const el = find(field);
    if (el && el.className !== value) el.className = value;
  };

  text('cap-level', view.levelLabel);
  text('cap-xp', view.xpLabel);
  width('cap-xp-bar', view.xpFraction);
  find('cap-xp-track')?.setAttribute('aria-valuenow', String(Math.round(view.xpFraction * 100)));
  text('cap-combo', view.comboLabel || NO_STREAK_TEXT);
  width('cap-combo-bar', view.comboFraction);
  cls('cap-combo-row', comboRowClass(view));
  text('cap-ult', view.ultimateLabel);
  width('cap-ult-bar', view.ultimateFraction);
  cls('cap-ult-row', ultRowClass(view));
  const chips = find('cap-chips');
  const markup = chipsMarkup(view);
  if (chips && chips.innerHTML !== markup) chips.innerHTML = markup;
}
