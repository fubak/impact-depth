import { headingDegrees } from '../core/sim';
import type { SimState } from '../core/types';

export class SonarScope {
  private readonly overlay: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly telemetry: HTMLElement;
  private readonly ctx: CanvasRenderingContext2D;
  private sweep = 0;

  constructor(overlay: HTMLElement, canvas: HTMLCanvasElement, telemetry: HTMLElement) {
    this.overlay = overlay;
    this.canvas = canvas;
    this.telemetry = telemetry;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Sonar canvas unsupported');
    this.ctx = ctx;
  }

  setActive(active: boolean): void {
    this.overlay.hidden = !active;
    this.overlay.setAttribute('aria-hidden', active ? 'false' : 'true');
  }

  render(sim: SimState, dt: number, reducedMotion: boolean): void {
    if (this.overlay.hidden) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const css = Math.min(520, Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.62));
    if (this.canvas.width !== Math.floor(css * dpr)) {
      this.canvas.width = Math.floor(css * dpr);
      this.canvas.height = Math.floor(css * dpr);
      this.canvas.style.width = `${css}px`;
      this.canvas.style.height = `${css}px`;
    }

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(cx, cy) * 0.92;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#050908';
    ctx.fillRect(0, 0, w, h);

    // PPI rings
    ctx.strokeStyle = 'rgba(92,174,157,0.28)';
    ctx.lineWidth = Math.max(1, w * 0.002);
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (radius * i) / 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Crosshairs / bearings
    ctx.strokeStyle = 'rgba(92,174,157,0.18)';
    for (let a = 0; a < 360; a += 30) {
      const rad = ((a - 90) * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(rad) * radius, cy + Math.sin(rad) * radius);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(92,174,157,0.7)';
    ctx.font = `${Math.floor(w * 0.028)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    for (const a of [0, 90, 180, 270]) {
      const rad = ((a - 90) * Math.PI) / 180;
      const lx = cx + Math.cos(rad) * (radius + w * 0.03);
      const ly = cy + Math.sin(rad) * (radius + w * 0.03);
      ctx.fillText(String(a).padStart(3, '0'), lx, ly);
    }

    // Contacts relative to own ship
    const own = sim.vessel;
    const maxRange = 120;
    for (const ship of sim.ships) {
      const dx = ship.x - own.x;
      const dz = ship.z - own.z;
      const range = Math.hypot(dx, dz);
      const bearing = Math.atan2(dz, dx);
      const rel = bearing - own.heading;
      const r = Math.min(1, range / maxRange) * radius;
      // Screen: 0° up = own heading
      const sx = cx + Math.sin(rel) * r;
      const sy = cy - Math.cos(rel) * r;

      const strength = ship.kind === 'destroyer' ? 1 : 0.7;
      ctx.fillStyle = `rgba(92,174,157,${0.55 + strength * 0.35})`;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(3, w * 0.008 * strength), 0, Math.PI * 2);
      ctx.fill();

      // Trace smear
      ctx.strokeStyle = `rgba(92,174,157,${0.25 * strength})`;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - Math.sin(rel) * w * 0.04, sy + Math.cos(rel) * w * 0.04);
      ctx.stroke();
    }

    // Own ship marker
    ctx.fillStyle = '#d8ded8';
    ctx.beginPath();
    ctx.moveTo(cx, cy - w * 0.018);
    ctx.lineTo(cx + w * 0.012, cy + w * 0.014);
    ctx.lineTo(cx - w * 0.012, cy + w * 0.014);
    ctx.closePath();
    ctx.fill();

    // Sweep
    if (!reducedMotion) {
      this.sweep = (this.sweep + dt * 1.15) % (Math.PI * 2);
    }
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, 'rgba(92,174,157,0.0)');
    grad.addColorStop(1, 'rgba(92,174,157,0.12)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, this.sweep - 0.55, this.sweep);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(92,174,157,0.85)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(this.sweep) * radius, cy + Math.sin(this.sweep) * radius);
    ctx.stroke();

    // Outer bezel
    ctx.strokeStyle = 'rgba(190,205,197,0.35)';
    ctx.lineWidth = Math.max(2, w * 0.006);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    const contacts = sim.ships
      .map((ship) => {
        const dx = ship.x - own.x;
        const dz = ship.z - own.z;
        const range = Math.hypot(dx, dz);
        const bearingWorld = Math.atan2(dz, dx);
        const brg = headingDegrees(bearingWorld);
        return { name: ship.name, range, brg, kind: ship.kind };
      })
      .sort((a, b) => a.range - b.range);

    this.telemetry.innerHTML = `
      <div class="sonar-title">PASSIVE PLOT</div>
      <div class="sonar-row"><span>OWN HDG</span><span>${String(headingDegrees(own.heading)).padStart(3, '0')}°</span></div>
      <div class="sonar-row"><span>DEPTH</span><span>${own.depth.toFixed(1)} m</span></div>
      <div class="sonar-row"><span>NOISE</span><span>${(own.noise * 100).toFixed(0)}%</span></div>
      <div class="sonar-divider"></div>
      ${contacts
        .map(
          (c) => `
        <div class="sonar-contact">
          <div class="sc-name">${c.name}</div>
          <div class="sc-meta">BRG ${String(c.brg).padStart(3, '0')}° · RNG ${c.range.toFixed(0)}u · ${c.kind.toUpperCase()}</div>
        </div>
      `,
        )
        .join('')}
    `;
  }
}
