import { ACTIVE_PING_DURATION, ACTIVE_PING_RANGE, THERMOCLINE } from './constants';
import type { GameState, Ship, ShipKind, SonarContact } from './types';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const passiveRadius: Record<ShipKind | 'player', number> = {
  player: 18, destroyer: 20, cruiser: 17, sub: 16, battleship: 14, patrol: 11, merchant: 7,
};
const machineryBase: Record<ShipKind, number> = {
  merchant: 0.72, battleship: 0.65, cruiser: 0.48, destroyer: 0.42, patrol: 0.38, sub: 0.18,
};
const shipMaxSpeed: Record<ShipKind, number> = {
  merchant: 1.15, destroyer: 2.35, patrol: 2.6, cruiser: 1.9, battleship: 1.35, sub: 1.7,
};
const contactLabels: Record<ShipKind, string> = {
  sub: 'U-BOAT', battleship: 'CAPITAL', destroyer: 'ESCORT', cruiser: 'CRUISER',
  merchant: 'MERCHANT', patrol: 'PATROL',
};

export function layerFactor(listenerDepth: number, targetDepth: number): number {
  if ((listenerDepth < THERMOCLINE) === (targetDepth < THERMOCLINE)) return 1;
  if (listenerDepth < THERMOCLINE) return 0.42 - clamp((targetDepth - THERMOCLINE) / 0.5, 0, 1) * 0.18;
  return 0.78;
}

export function shipMachineryNoise(ship: Ship): number {
  const speed = clamp(ship.speed / shipMaxSpeed[ship.kind], 0, 1);
  return clamp(machineryBase[ship.kind] * 0.45 + speed * speed * 0.55 + (ship.alert > 0.5 ? 0.08 : 0), 0.08, 1);
}

export function passiveRange(listener: ShipKind | 'player', noise: number, listenerDepth: number, targetDepth: number, mask = 1): number {
  const immersion = listenerDepth > 0.08 ? 1.08 : 0.92;
  return passiveRadius[listener] * (0.35 + noise * 1.35) * layerFactor(listenerDepth, targetDepth) * immersion * mask;
}

function contactLabel(ship: Ship, strength: number): string {
  if (strength < 0.28) return 'CONTACT';
  if (strength < 0.5) return ship.kind === 'sub' ? 'SUB?' : 'MERCHANT?';
  return contactLabels[ship.kind];
}

function maskAt(state: GameState, x: number, y: number): number {
  return state.countermeasures.reduce((mask, cm) =>
    Math.hypot(cm.x - x, cm.y - y) <= cm.radius + 2.5 ? mask * (cm.kind === 'bubble' ? 0.45 : 0.65) : mask, 1);
}

function mergeContacts(contacts: SonarContact[]): SonarContact[] {
  const merged = new Map<string, SonarContact>();
  for (const contact of contacts) {
    const key = contact.targetId ?? contact.id;
    const previous = merged.get(key);
    if (!previous || contact.source === 'active' || contact.strength > previous.strength) merged.set(key, contact);
  }
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 6);
}

export function updateSonar(state: GameState, dt: number): GameState {
  const sub = state.submarine;
  const decayed = state.sonarContacts
    .map((contact) => ({ ...contact, age: contact.age + dt, strength: contact.strength * 0.97 }))
    .filter((contact) => contact.age < contact.maxAge);
  const contacts: SonarContact[] = [...decayed];
  const activeAge = ACTIVE_PING_DURATION - state.sonarPing;
  const activeRadius = state.sonarPing > 0 ? Math.min(ACTIVE_PING_RANGE, activeAge / 1.05 * ACTIVE_PING_RANGE) : 0;

  for (const ship of state.ships) {
    if (ship.sinking !== undefined) continue;
    const distance = Math.hypot(ship.x - sub.x, ship.y - sub.y);
    const targetDepth = ship.kind === 'sub' ? 0.35 : 0.02;
    const range = passiveRange('player', shipMachineryNoise(ship), sub.z, targetDepth, maskAt(state, ship.x, ship.y));
    if (distance <= range) {
      const strength = clamp((1 - distance / range) * (0.55 + shipMachineryNoise(ship) * 0.55), 0.12, 1);
      const jitter = (1 - strength) * 0.55;
      const x = ship.x + Math.sin(state.time * 0.4 + ship.id.length) * jitter;
      const y = ship.y + Math.cos(state.time * 0.35 + ship.id.length * 0.7) * jitter;
      contacts.push({ id: `passive-${ship.id}`, targetId: ship.id, x, y, bearing: Math.atan2(y - sub.y, x - sub.x), range: distance, strength, label: contactLabel(ship, strength), source: 'passive', age: 0, maxAge: 1.15 });
    }
    if (state.sonarPing > 0 && distance <= ACTIVE_PING_RANGE && distance <= activeRadius + 1.2) {
      const strength = clamp(1 - distance / ACTIVE_PING_RANGE, 0.3, 1);
      contacts.push({ id: `active-${ship.id}`, targetId: ship.id, x: ship.x, y: ship.y, bearing: Math.atan2(ship.y - sub.y, ship.x - sub.x), range: distance, strength, label: contactLabel(ship, Math.min(1, strength + 0.3)), source: 'active', age: 0, maxAge: 2.8 });
    }
  }
  for (const cm of state.countermeasures.filter((candidate) => candidate.kind === 'foxer')) {
    const distance = Math.hypot(cm.x - sub.x, cm.y - sub.y);
    if (distance < 20) contacts.push({ id: `noise-${cm.id}`, targetId: null, x: cm.x, y: cm.y, bearing: Math.atan2(cm.y - sub.y, cm.x - sub.x), range: distance, strength: 0.7, label: 'NOISE', source: 'passive', age: 0, maxAge: 0.3 });
  }
  return {
    ...state,
    sonarPing: Math.max(0, state.sonarPing - dt),
    sonarCooldown: Math.max(0, state.sonarCooldown - dt),
    sonarContacts: mergeContacts(contacts),
  };
}

export function fireActiveSonar(state: GameState): GameState | null {
  if (state.phase !== 'playing' || state.sonarPing > 0 || state.sonarCooldown > 0) return null;
  return {
    ...state,
    sonarPing: ACTIVE_PING_DURATION,
    sonarCooldown: 6.5,
    submarine: { ...state.submarine, noise: clamp(state.submarine.noise + 0.62, 0, 1) },
    ships: state.ships.map((ship) => {
      const distance = Math.hypot(ship.x - state.submarine.x, ship.y - state.submarine.y);
      return distance > 30 ? ship : { ...ship, alert: clamp(ship.alert + 0.35 * (1 - distance / 30), 0, 1) };
    }),
  };
}
