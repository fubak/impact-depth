type Anchor = 'center' | 'status' | 'depth' | 'tactics' | 'magazine' | 'minimap' | 'contacts' | 'canvas';
type Step = { title: string; body: string; tip: string; anchor: Anchor };

const STORAGE_KEY = 'silent-depths-tutorial-v1';
const STEPS: readonly Step[] = [
  { title: 'Welcome aboard, Captain', body: 'This tour covers helm, stealth, weapons, and the combat AI. Reopen Help from the HUD whenever you need it.', tip: 'Dark blue is deep water. Land is impassable.', anchor: 'center' },
  { title: 'Plot a course', body: 'Click open water or the tactical plot to set a waypoint. The boat navigates around shoals. Right-click fires at the selected target.', tip: 'Drag the tactical view and use the wheel to zoom.', anchor: 'canvas' },
  { title: 'Hull, battery & noise', body: 'Hull is life. Battery drains underwater. Noise is what enemy hydrophones hear.', tip: 'The layer badge shows your side of the thermocline.', anchor: 'status' },
  { title: 'Depth & speed', body: 'Surface is fast but exposed. Periscope depth enables visual attacks. Deep is quieter and safer but slower.', tip: 'Dead slow plus Silent is a reliable transit profile.', anchor: 'depth' },
  { title: 'Stealth tactics', body: 'Silent reduces noise. Scope is risky but useful at periscope depth. Snorkel charges batteries but exposes you.', tip: 'Ambush, Stalk, Intercept, Evade and RTB can take the helm.', anchor: 'tactics' },
  { title: 'Ambush doctrine', body: 'Ambush approaches quietly on a target beam, rises for the shot, fires a spread, and breaks deep.', tip: 'Stalk trails, Intercept closes, Evade disengages, and RTB docks at FOB.', anchor: 'tactics' },
  { title: 'Magazine & sonar', body: 'Mk-14s are straight runners. Mk-18s seek. Foxer and bubble screen defeat threats. Sonar improves range but creates risk.', tip: 'Fire only when the tube is ready and your depth allows it.', anchor: 'magazine' },
  { title: 'Hydrophone picture', body: 'Passive contacts give bearing and approximate range. Active returns are sharper, but escorts hear your ping.', tip: 'Select a contact to aim manual fire or give AI a target.', anchor: 'contacts' },
  { title: 'Minimap & FOB', body: 'The tactical plot shows contacts, crates, land, and FOB Argus. Dock inside its cyan ring to repair and restock safely.', tip: 'Click the plot for a long-range course.', anchor: 'minimap' },
  { title: 'What hunts you', body: 'Destroyers use Hedgehog, capital ships depth charge, enemy submarines torpedo, and aircraft punish shallow noise.', tip: 'Go silent and deep below the layer; screen, then RTB if flooding.', anchor: 'center' },
  { title: 'You are on station', body: 'Sink ships to clear the sector. Reopen this guide from Help anytime.', tip: 'Stay quiet, shoot from the beam, and get home.', anchor: 'center' },
];

export class TutorialOverlay {
  private step = 0;
  private open = false;

  constructor(private readonly root: HTMLElement) {
    root.addEventListener('click', this.onClick);
    window.addEventListener('keydown', this.onKeyDown);
  }

  show(force = false): void {
    if (!force && this.completed()) return;
    this.open = true;
    this.step = 0;
    this.render();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
  }

  private completed(): boolean {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  }

  private finish(): void {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* storage unavailable */ }
    this.open = false;
    this.root.hidden = true;
    this.root.innerHTML = '';
  }

  private render(): void {
    const current = STEPS[this.step]!;
    const anchor = current.anchor === 'canvas' ? document.querySelector('#scene') : document.querySelector(`[data-tutorial="${current.anchor}"]`);
    const rect = anchor?.getBoundingClientRect();
    const style = rect ? `--spot-x:${rect.left - 8}px;--spot-y:${rect.top - 8}px;--spot-w:${rect.width + 16}px;--spot-h:${rect.height + 16}px` : '';
    this.root.hidden = false;
    this.root.innerHTML = `<div class="tutorial-dim"${rect ? ` style="${style}"` : ''}></div><section class="tutorial-card" role="dialog" aria-modal="true" aria-labelledby="tutorial-title"><div class="panel-label">TUTORIAL · ${this.step + 1}/${STEPS.length}</div><h2 id="tutorial-title">${current.title}</h2><p>${current.body}</p><p class="tutorial-tip"><b>TIP</b> ${current.tip}</p><div class="tutorial-actions"><button class="hud-btn" data-tutorial-action="back" ${this.step === 0 ? 'disabled' : ''}>Back</button><button class="hud-btn" data-tutorial-action="skip">Skip</button><button class="hud-btn active" data-tutorial-action="next">${this.step === STEPS.length - 1 ? 'Finish' : 'Next'}</button></div></section>`;
    (this.root.querySelector('[data-tutorial-action="next"]') as HTMLButtonElement | null)?.focus();
  }

  private readonly onClick = (event: MouseEvent): void => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-tutorial-action]')?.dataset.tutorialAction;
    if (action === 'back') { this.step--; this.render(); }
    if (action === 'next') { if (this.step === STEPS.length - 1) this.finish(); else { this.step++; this.render(); } }
    if (action === 'skip') this.finish();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.open || event.code !== 'Escape') return;
    event.preventDefault();
    this.finish();
  };
}
