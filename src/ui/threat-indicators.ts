import type { GameState } from '../game/sim/types';

/** Enemy torpedoes farther than this (sim units, horizontal) are not marked. */
export const THREAT_TORPEDO_RANGE = 25;
/** Ships at or below this alert are not yet a contact worth an edge chevron. */
export const THREAT_ALERT_MIN = 0.25;
export const DEFAULT_THREAT_MARGIN = 28;

export interface ThreatProjection {
  sx: number;
  sy: number;
  /** In front of the camera and inside the viewport. Those threats are not marked. */
  onScreen: boolean;
  /**
   * True when the point is behind the camera. `sx`/`sy` are the raw perspective-divide
   * pixels, which land on the mirrored side of the viewport.
   */
  behind?: boolean;
}

export interface ThreatViewport {
  width: number;
  height: number;
  margin?: number;
}

export type ThreatEdge = 'left' | 'right' | 'top' | 'bottom';
export type ThreatMarkerKind = 'torpedo' | 'ship' | 'aircraft' | 'charge';

export interface ThreatMarker {
  id: string;
  kind: ThreatMarkerKind;
  /** Absolute sim bearing, radians, atan2(dy, dx) from the submarine. */
  bearing: number;
  /** Horizontal range in sim units. */
  range: number;
  /** Higher is drawn first. Torpedoes outrank aircraft, which outrank ships. */
  urgency: number;
  sx: number;
  sy: number;
  edge: ThreatEdge;
}

interface Candidate {
  id: string;
  kind: ThreatMarkerKind;
  x: number;
  y: number;
  z: number;
  alert: number;
}

const LABEL: Record<ThreatMarkerKind, string> = {
  torpedo: 'TORP',
  ship: 'SHIP',
  aircraft: 'AIR',
  charge: 'DC',
};

function horizontalRange(originX: number, originY: number, x: number, y: number): number {
  return Math.hypot(x - originX, y - originY);
}

function collectCandidates(game: GameState): Candidate[] {
  const sub = game.submarine;
  const candidates: Candidate[] = [];
  for (const torpedo of game.torpedoes) {
    if (torpedo.owner !== 'enemy') continue;
    const range = horizontalRange(sub.x, sub.y, torpedo.x, torpedo.y);
    if (range > THREAT_TORPEDO_RANGE) continue;
    candidates.push({
      id: torpedo.id,
      kind: 'torpedo',
      x: torpedo.x,
      y: torpedo.y,
      z: torpedo.z,
      alert: 1,
    });
  }
  for (const ship of game.ships) {
    if (ship.sinking != null || ship.alert <= THREAT_ALERT_MIN) continue;
    candidates.push({ id: ship.id, kind: 'ship', x: ship.x, y: ship.y, z: 0, alert: ship.alert });
  }
  for (const charge of game.depthCharges) {
    candidates.push({
      id: charge.id,
      kind: 'charge',
      x: charge.x,
      y: charge.y,
      z: charge.z,
      alert: 1,
    });
  }
  for (const aircraft of game.aircraft) {
    if (!aircraft.active) continue;
    candidates.push({
      id: aircraft.id,
      kind: 'aircraft',
      x: aircraft.x,
      y: aircraft.y,
      z: 0,
      alert: 1,
    });
  }
  return candidates;
}

function urgencyOf(kind: ThreatMarkerKind, range: number, alert: number): number {
  if (kind === 'torpedo' || kind === 'charge') {
    const closeness = 1 - Math.min(range, THREAT_TORPEDO_RANGE) / THREAT_TORPEDO_RANGE;
    return 2 + closeness;
  }
  const closeness = 1 / (1 + range / 20);
  return kind === 'aircraft' ? 1 + closeness : alert * closeness;
}

/**
 * Reflect a behind-camera projection through the viewport center, then push the
 * direction from center out to the inset edge. In-front off-screen points are
 * clamped along their raw direction, which is already the true side.
 */
function clampToEdge(
  projection: ThreatProjection,
  viewport: ThreatViewport,
): { sx: number; sy: number; edge: ThreatEdge } | null {
  if (projection.onScreen) return null;
  const { width, height } = viewport;
  const margin = viewport.margin ?? DEFAULT_THREAT_MARGIN;
  const x = projection.behind ? width - projection.sx : projection.sx;
  const y = projection.behind ? height - projection.sy : projection.sy;
  const cx = width / 2;
  const cy = height / 2;
  const dx = x - cx;
  let dy = y - cy;
  if (dx === 0 && dy === 0) dy = 1;
  const insetX = Math.max(1, width / 2 - margin);
  const insetY = Math.max(1, height / 2 - margin);
  const ax = Math.abs(dx) / insetX;
  const ay = Math.abs(dy) / insetY;
  const scale = Math.max(ax, ay);
  const edge: ThreatEdge = ax >= ay ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'top' : 'bottom';
  return { sx: cx + dx / scale, sy: cy + dy / scale, edge };
}

export function computeThreatMarkers(
  game: GameState,
  project: (x: number, y: number, z: number) => ThreatProjection,
  viewport: ThreatViewport = { width: 1280, height: 720, margin: DEFAULT_THREAT_MARGIN },
  options: { underwater?: boolean } = {},
): ThreatMarker[] {
  const sub = game.submarine;
  const markers: ThreatMarker[] = [];
  for (const candidate of collectCandidates(game)) {
    const projection = project(candidate.x, candidate.y, candidate.z);
    const range = horizontalRange(sub.x, sub.y, candidate.x, candidate.y);
    const showThroughFog =
      candidate.kind === 'charge' &&
      options.underwater === true &&
      projection.onScreen &&
      range > 12;
    const clamped = showThroughFog
      ? { sx: projection.sx, sy: projection.sy, edge: 'top' as const }
      : clampToEdge(projection, viewport);
    if (!clamped) continue;
    markers.push({
      id: candidate.id,
      kind: candidate.kind,
      bearing: Math.atan2(candidate.y - sub.y, candidate.x - sub.x),
      range,
      urgency: urgencyOf(candidate.kind, range, candidate.alert),
      sx: clamped.sx,
      sy: clamped.sy,
      edge: clamped.edge,
    });
  }
  markers.sort((left, right) => right.urgency - left.urgency || left.id.localeCompare(right.id));
  return markers;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatRange(range: number): string {
  return range < 10 ? range.toFixed(1) : String(Math.round(range));
}

/** DOM chevrons for `computeThreatMarkers`. Positioning uses the marker's screen pixels. */
export class ThreatIndicatorLayer {
  constructor(private readonly root: HTMLElement) {
    this.root.classList.add('threat-layer');
    this.root.setAttribute('aria-hidden', 'true');
  }

  render(markers: readonly ThreatMarker[]): void {
    this.root.innerHTML = markers
      .map((marker) => {
        const label = `${LABEL[marker.kind]} ${formatRange(marker.range)}`;
        return (
          `<div class="threat-marker" data-kind="${marker.kind}" data-edge="${marker.edge}" ` +
          `data-id="${escapeHtml(marker.id)}" style="left:${marker.sx}px;top:${marker.sy}px">` +
          `<span class="threat-marker-arrow"></span>` +
          `<span class="threat-marker-label">${escapeHtml(label)}</span></div>`
        );
      })
      .join('');
  }
}
