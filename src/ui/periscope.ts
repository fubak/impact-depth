import { headingDegrees } from '../core/sim';
import type { LookDevSettings, SimState } from '../core/types';

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

    // Nearest contact range along look bearing (approx)
    let nearest = Infinity;
    let label = '—';
    const look = sim.vessel.heading + periYaw;
    for (const ship of sim.ships) {
      const dx = ship.x - sim.vessel.x;
      const dz = ship.z - sim.vessel.z;
      const brg = Math.atan2(dz, dx);
      let diff = brg - look;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < 0.35) {
        const r = Math.hypot(dx, dz);
        if (r < nearest) {
          nearest = r;
          label = `${r.toFixed(0)} u`;
          const lead = Math.sin(brg - sim.vessel.heading) * ship.speed * 0.35;
          this.root.style.setProperty('--lead', String(lead * 40));
        }
      }
    }
    this.range.textContent = `RANGE ${label}`;
    this.root.style.setProperty('--vignette', String(0.35 + settings.presentation.vignette * 0.5));
  }
}
