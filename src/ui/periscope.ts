import { headingDegrees } from '../core/sim';
import type { LookDevSettings, SimState } from '../core/types';
import { METERS_PER_UNIT } from '../game/sim/constants';

/** Half-width of the periscope's range cone, radians. */
const RANGE_CONE = 0.35;

interface RangeVessel {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
}
interface RangeShip {
  readonly x: number;
  readonly z: number;
  readonly speed: number;
}

/**
 * Nearest contact inside the look cone. Render space is metres; the readout is in sim units
 * so it agrees with the target card and the rest of the HUD.
 */
export function nearestRangeUnits(
  vessel: RangeVessel,
  ships: readonly RangeShip[],
  periYaw: number,
): { units: number; bearing: number; ship: RangeShip } | null {
  const look = vessel.heading + periYaw;
  let best: { units: number; bearing: number; ship: RangeShip } | null = null;
  for (const ship of ships) {
    const dx = ship.x - vessel.x;
    const dz = ship.z - vessel.z;
    const bearing = Math.atan2(dz, dx);
    let diff = bearing - look;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) >= RANGE_CONE) continue;
    const units = Math.hypot(dx, dz) / METERS_PER_UNIT;
    if (!best || units < best.units) best = { units, bearing, ship };
  }
  return best;
}

export class PeriscopeOverlay {
  private readonly root: HTMLElement;
  private readonly bearing: HTMLElement;
  private readonly range: HTMLElement;

  constructor(root: HTMLElement, bearing: HTMLElement, range: HTMLElement) {
    this.root = root;
    this.bearing = bearing;
    this.range = range;
  }

  setActive(active: boolean): void {
    this.root.hidden = !active;
    this.root.setAttribute('aria-hidden', active ? 'false' : 'true');
  }

  render(sim: SimState, settings: LookDevSettings, periYaw: number): void {
    if (this.root.hidden) return;

    const hdg = headingDegrees(sim.vessel.heading + periYaw);
    const ticks: string[] = [];
    for (let i = -40; i <= 40; i += 5) {
      const b = (hdg + i + 360) % 360;
      const major = i % 10 === 0;
      ticks.push(
        `<span class="tick ${major ? 'major' : ''}" style="--off:${i}">${major ? String(Math.round(b)).padStart(3, '0') : ''}</span>`,
      );
    }
    this.bearing.innerHTML = `<div class="bearing-tape">${ticks.join('')}<div class="bearing-cursor"></div></div>`;

    const contact = nearestRangeUnits(sim.vessel, sim.ships, periYaw);
    const label = contact ? `${contact.units.toFixed(0)} u` : '—';
    if (contact) {
      const lead = Math.sin(contact.bearing - sim.vessel.heading) * contact.ship.speed * 0.35;
      this.root.style.setProperty('--lead', String(lead * 40));
    }
    this.range.textContent = `RANGE ${label}`;
    this.root.style.setProperty('--vignette', String(0.35 + settings.presentation.vignette * 0.5));
  }
}
