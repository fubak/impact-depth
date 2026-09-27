import { describe, expect, it } from 'vitest';
import { createGame } from '../../src/game/sim/api';
import type { Aircraft, GameState, Ship, Submarine, Torpedo } from '../../src/game/sim/types';
import {
  ThreatIndicatorLayer,
  computeThreatMarkers,
  type ThreatProjection,
  type ThreatViewport,
} from '../../src/ui/threat-indicators';

const VIEW: ThreatViewport = { width: 200, height: 100, margin: 10 };
const base = createGame(1);
const hull = base.ships[0];
if (!hull) throw new Error('createGame(1) has no ship to clone');

function patrol(overrides: {
  torpedoes?: Torpedo[];
  ships?: Ship[];
  aircraft?: Aircraft[];
  submarine?: Partial<Submarine>;
}): GameState {
  return {
    ...base,
    torpedoes: overrides.torpedoes ?? [],
    ships: overrides.ships ?? [],
    aircraft: overrides.aircraft ?? [],
    submarine: { ...base.submarine, x: 0, y: 0, heading: Math.PI / 2, ...overrides.submarine },
  };
}

function enemyTorpedo(id: string, x: number, y: number, z = 0): Torpedo {
  return {
    id,
    owner: 'enemy',
    kind: 'enemy',
    x,
    y,
    z,
    heading: 0,
    speed: 1,
    life: 20,
    armDelay: 0,
    damage: 10,
    targetId: 'player',
    sourceId: 'escort',
    turnRate: 0,
    run: 0,
  };
}

function shipAt(id: string, x: number, y: number, alert: number): Ship {
  return { ...hull, id, name: id, x, y, alert };
}

function plane(id: string, x: number, y: number, active: boolean): Aircraft {
  return { id, x, y, heading: 0, life: 30, cooldown: 0, active };
}

/** Raw perspective divide: behind-camera points come back mirrored. */
function projectOf(game: GameState): (x: number, y: number, z: number) => ThreatProjection {
  const sub = game.submarine;
  const forwardX = Math.cos(sub.heading);
  const forwardY = Math.sin(sub.heading);
  const rightX = forwardY;
  const rightY = -forwardX;
  return (x, y, z) => {
    const dx = x - sub.x;
    const dy = y - sub.y;
    const depth = dx * forwardX + dy * forwardY;
    const right = dx * rightX + dy * rightY;
    const behind = depth <= 0;
    const safe = Math.abs(depth) < 1e-6 ? (behind ? -1e-6 : 1e-6) : depth;
    const ndcX = right / safe;
    const ndcY = z / safe;
    const sx = (ndcX * 0.5 + 0.5) * VIEW.width;
    const sy = (-ndcY * 0.5 + 0.5) * VIEW.height;
    const onScreen = !behind && sx >= 0 && sx <= VIEW.width && sy >= 0 && sy <= VIEW.height;
    return { sx, sy, onScreen, behind };
  };
}

function fakeRoot(): HTMLElement {
  const state = { html: '' };
  return {
    classList: { add: () => undefined },
    setAttribute: () => undefined,
    get innerHTML() {
      return state.html;
    },
    set innerHTML(value: string) {
      state.html = value;
    },
  } as unknown as HTMLElement;
}

describe('computeThreatMarkers', () => {
  it('clamps a torpedo behind the camera to the edge on the threat’s true side', () => {
    // Heading +Y. (-4, -2) is behind the boat and to port. A raw perspective
    // divide mirrors that onto the starboard side; the marker must flip back.
    const game = patrol({
      torpedoes: [
        enemyTorpedo('incoming', -4, -2),
        { ...enemyTorpedo('own-shot', -4, -2), owner: 'player', kind: 'mk14' },
        enemyTorpedo('distant', 0, -40),
      ],
    });
    const markers = computeThreatMarkers(game, projectOf(game), VIEW);
    expect(markers.map((marker) => marker.id)).toEqual(['incoming']);
    expect(markers[0]?.edge).toBe('left');
    expect(markers[0]?.sx).toBeCloseTo(VIEW.margin ?? 0, 5);
    expect(markers[0]?.sy).toBeCloseTo(VIEW.height / 2, 5);
    expect(markers[0]?.range).toBeCloseTo(Math.hypot(4, 2), 5);
    expect(markers[0]?.bearing).toBeCloseTo(Math.atan2(-2, -4), 5);
  });

  it('marks a nearby on-screen torpedo as well as one behind the camera', () => {
    const game = patrol({
      torpedoes: [enemyTorpedo('visible', 0, 8, 0), enemyTorpedo('hidden', -4, -2)],
    });
    const markers = computeThreatMarkers(game, projectOf(game), VIEW);
    expect(markers.map((marker) => marker.id).sort()).toEqual(['hidden', 'visible']);
    expect(markers.find((marker) => marker.id === 'visible')?.edge).toBe('screen');
    expect(markers.find((marker) => marker.id === 'hidden')?.edge).toBe('left');
  });

  it('orders off-screen markers by descending urgency', () => {
    // Range-24 torpedo (urgency just above 2) beats a near aircraft (under 2),
    // which beats an alerted ship (under 1). Insertion order is the reverse.
    const game = patrol({
      ships: [shipAt('hunter', 3, 0, 0.9), shipAt('calm', 4, 0, 0.1)],
      aircraft: [plane('bomber', 0, -2, true), plane('parked', 6, 0, false)],
      torpedoes: [enemyTorpedo('far-torp', 0, -24)],
    });
    const markers = computeThreatMarkers(game, projectOf(game), VIEW);
    expect(markers.map((marker) => marker.id)).toEqual(['far-torp', 'bomber', 'hunter']);
    expect(markers[0]!.urgency).toBeGreaterThan(markers[1]!.urgency);
    expect(markers[1]!.urgency).toBeGreaterThan(markers[2]!.urgency);
    expect(markers.map((marker) => marker.kind)).toEqual(['torpedo', 'aircraft', 'ship']);
  });

  it('paints a nearby on-screen torpedo and the off-screen one', () => {
    const game = patrol({
      torpedoes: [enemyTorpedo('visible', 0, 8), enemyTorpedo('hidden', -4, -2)],
    });
    const markers = computeThreatMarkers(game, projectOf(game), VIEW);
    const root = fakeRoot();
    new ThreatIndicatorLayer(root).render(markers);
    expect(root.innerHTML).toContain('data-id="hidden"');
    expect(root.innerHTML).toContain('data-edge="left"');
    expect(root.innerHTML).toContain('data-id="visible"');
    expect(root.innerHTML).toContain('TORP');
  });

  it('keeps an on-screen charge inside 12 units and prints its fuse', () => {
    const game = patrol({});
    game.depthCharges = [
      {
        id: 'close',
        kind: 'hedgehog',
        sourceId: 'tutorial',
        x: 0,
        y: 4,
        z: 0.5,
        vz: 0,
        fuse: 6.2,
        damage: 12,
        radius: 1.7,
        targetDepth: 0.5,
      },
    ];
    const markers = computeThreatMarkers(game, projectOf(game), VIEW, { underwater: true });
    expect(markers.map((marker) => marker.id)).toEqual(['close']);
    expect(markers[0]?.edge).toBe('screen');
    const root = fakeRoot();
    new ThreatIndicatorLayer(root).render(markers);
    expect(root.innerHTML).toContain('DC 4.0 7s');
  });
});
