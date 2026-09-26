import {
  applyPreset,
  cloneSettings,
  DEFAULT_SETTINGS,
  isPresetId,
  loadPlayPreferences,
  savePlayPreferences,
  saveSettings,
  settingsToJson,
  STORAGE_KEY,
  type PlayPreferences,
} from '../core/settings';
import type { LookDevSettings, PresetId } from '../core/types';

export type PanelCallbacks = {
  onChange: (settings: LookDevSettings) => void;
  onClose: () => void;
};

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export type AssetCreditLine = {
  id: string;
  source: string;
  license: string;
  usage: string;
};

export class LookDevPanel {
  private readonly root: HTMLElement;
  private settings: LookDevSettings;
  private play: PlayPreferences;
  private readonly cb: PanelCallbacks;
  private visible = false;
  private perfEl: HTMLElement | null = null;
  private surfaceEl: HTMLElement | null = null;
  private assetCredits: AssetCreditLine[] = [];

  constructor(root: HTMLElement, settings: LookDevSettings, cb: PanelCallbacks) {
    this.root = root;
    this.settings = cloneSettings(settings);
    this.play = loadPlayPreferences();
    this.cb = cb;
    this.root.classList.add('lookdev');
    this.render();
  }

  isVisible(): boolean {
    return this.visible;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.hidden = !v;
    this.root.setAttribute('aria-hidden', v ? 'false' : 'true');
    if (v) {
      const first = this.root.querySelector<HTMLElement>('button, input, select');
      first?.focus();
    }
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  getSettings(): LookDevSettings {
    return this.settings;
  }

  setSettings(settings: LookDevSettings): void {
    this.settings = cloneSettings(settings);
    this.render();
  }

  /** Lightweight FPS / frame-time — only meaningful while panel is open. */
  setPerf(fps: number, frameMs: number, quality = 'high'): void {
    if (!this.visible || !this.perfEl) return;
    this.perfEl.textContent = `${fps.toFixed(0)} FPS · ${frameMs.toFixed(1)} ms · ${quality.toUpperCase()} quality`;
  }

  /** Developer surface/probe line. Hidden from the player HUD. */
  setSurfaceDiagnostics(line: string | null): void {
    if (!this.visible || !this.surfaceEl) return;
    this.surfaceEl.textContent = line ?? 'surface probes idle';
  }

  /** CC-BY / project license ledger for in-game attribution. */
  setAssetCredits(entries: ReadonlyArray<AssetCreditLine>): void {
    this.assetCredits = entries.map((entry) => ({ ...entry }));
    // Rebuild even when closed so the first open is not stuck on the empty placeholder.
    this.render();
  }

  private emit(): void {
    saveSettings(this.settings);
    this.cb.onChange(cloneSettings(this.settings));
  }

  private setPreset(id: PresetId): void {
    this.settings = applyPreset(id);
    this.render();
    this.emit();
  }

  private render(): void {
    const s = this.settings;
    const reduced = prefersReducedMotion();
    this.root.innerHTML = `
      <header class="lookdev-header">
        <div>
          <div class="lookdev-title">LOOK DEV</div>
          <div class="lookdev-sub">SILENT DEPTHS · CARIBBEAN LAB</div>
          <div class="lookdev-perf" data-perf aria-live="polite">— FPS · HIGH quality</div>
          <div class="lookdev-perf" data-surface-diag aria-live="polite">surface probes idle</div>
        </div>
        <button type="button" class="btn icon" data-action="close" aria-label="Close panel">✕</button>
      </header>

      <section class="lookdev-section">
        <h2>PRESETS</h2>
        <div class="btn-row">
          <button type="button" class="btn ${s.preset === 'caribbean-noon' ? 'active' : ''}" data-preset="caribbean-noon">Caribbean Noon</button>
          <button type="button" class="btn ${s.preset === 'trade-wind-morning' ? 'active' : ''}" data-preset="trade-wind-morning">Trade Wind Morning</button>
          <button type="button" class="btn ${s.preset === 'golden-cay' ? 'active' : ''}" data-preset="golden-cay">Golden Cay</button>
        </div>
      </section>

      <section class="lookdev-section">
        <h2>ATMOSPHERE</h2>
        ${slider('timeOfDay', 'Time of day', s.atmosphere.timeOfDay, 0, 1, 0.01)}
        ${slider('fogDensity', 'Haze', s.atmosphere.fogDensity, 0.0004, 0.02, 0.0002)}
        ${slider('exposure', 'Exposure', s.atmosphere.exposure, 0.4, 1.4, 0.01)}
        ${slider('sunElevation', 'Sun elevation', s.atmosphere.sunElevation, -10, 85, 1)}
        ${slider('sunAzimuth', 'Sun azimuth', s.atmosphere.sunAzimuth, 0, 360, 1)}
        ${slider('sunIntensity', 'Sun intensity', s.atmosphere.sunIntensity, 0.4, 1.8, 0.01)}
      </section>

      <section class="lookdev-section">
        <h2>OCEAN</h2>
        ${slider('clarity', 'Water clarity', s.ocean.clarity, 0.2, 1, 0.01)}
        ${slider('absorption', 'Absorption', s.ocean.absorption, 0, 1, 0.01)}
        ${slider('seaState', 'Sea state', s.ocean.seaState, 0, 1, 0.01)}
        ${slider('waveHeight', 'Wave height', s.ocean.waveHeight, 0.15, 1.8, 0.01)}
        ${slider('choppiness', 'Choppiness', s.ocean.choppiness, 0.1, 1.2, 0.01)}
        ${slider('foamAmount', 'Foam amount', s.ocean.foamAmount, 0, 1, 0.01)}
        ${colorField('deepColor', 'Deep water', s.ocean.deepColor)}
        ${colorField('shallowColor', 'Shallow water', s.ocean.shallowColor)}
      </section>

      <section class="lookdev-section">
        <h2>LITTORAL</h2>
        ${colorField('sandColor', 'Sand / beach', s.environment.sandColor)}
        ${colorField('foliageColor', 'Foliage', s.environment.foliageColor)}
        ${colorField('rockColor', 'Rock / mountain', s.environment.rockColor)}
      </section>

      <section class="lookdev-section">
        <h2>PLAY</h2>
        ${slider('masterVolume', 'Master volume', this.play.masterVolume, 0, 1, 0.01, 'play')}
        ${choice('reducedMotion', 'Reduced motion', this.play.reducedMotion, [
          ['system', 'Match system'],
          ['reduce', 'Reduce'],
          ['allow', 'Allow motion'],
        ])}
        ${choice('quality', 'Quality', this.play.quality, [
          ['auto', 'Auto'],
          ['high', 'High'],
          ['medium', 'Medium'],
          ['low', 'Low'],
        ])}
        <label class="field"><input type="checkbox" data-play-flag="captions" ${this.play.captions ? 'checked' : ''}/> Captions</label>
        <label class="field"><input type="checkbox" data-play-flag="pauseOnBlur" ${this.play.pauseOnBlur ? 'checked' : ''}/> Pause when the window blurs</label>
        <p class="hint">Keys: 1–7 views, WASD helm, F fire, V deep, Space pause, H panel, M 4× transit.</p>
      </section>

      <section class="lookdev-section">
        <h2>PRESENTATION</h2>
        ${slider('hudOpacity', 'HUD opacity', s.presentation.hudOpacity, 0.4, 1, 0.01)}
        ${slider('labelDensity', 'Label density', s.presentation.labelDensity, 0, 1, 0.01)}
        ${slider('filmGrain', `Film grain${reduced ? ' (reduced)' : ''}`, s.presentation.filmGrain, 0, 0.5, 0.01)}
        ${slider('vignette', 'Vignette', s.presentation.vignette, 0, 0.8, 0.01)}
        <label class="check">
          <input type="checkbox" data-field="tacticalGrid" ${s.presentation.tacticalGrid ? 'checked' : ''} />
          <span>Tactical grid</span>
        </label>
      </section>

      <section class="lookdev-section">
        <h2>ASSET CREDITS</h2>
        ${
          this.assetCredits.length === 0
            ? `<p class="lookdev-credit-empty">Loading license ledger…</p>`
            : `<ul class="lookdev-credits">${this.assetCredits
                .map(
                  (entry) => `<li>
              <strong>${escapeHtml(entry.id)}</strong>
              <span class="lookdev-credit-license">${escapeHtml(entry.license)}</span>
              <span class="lookdev-credit-source">${escapeHtml(entry.source)}</span>
              <span class="lookdev-credit-usage">${escapeHtml(entry.usage)}</span>
            </li>`,
                )
                .join('')}</ul>`
        }
      </section>

      <section class="lookdev-section actions">
        <button type="button" class="btn" data-action="reset">Reset</button>
        <button type="button" class="btn primary" data-action="copy">Copy settings JSON</button>
      </section>
      <p class="lookdev-hint">Values persist in localStorage · key ${STORAGE_KEY}</p>
    `;

    this.perfEl = this.root.querySelector('[data-perf]');
    this.surfaceEl = this.root.querySelector('[data-surface-diag]');
    this.bind();
  }

  private bind(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.preset ?? '';
        if (isPresetId(id)) this.setPreset(id);
      });
    });

    this.root.querySelectorAll<HTMLElement>('[data-action]').forEach((el) => {
      el.addEventListener('click', async () => {
        const action = el.dataset.action;
        if (action === 'close') this.cb.onClose();
        if (action === 'reset') {
          this.settings = cloneSettings(DEFAULT_SETTINGS);
          this.render();
          this.emit();
        }
        if (action === 'copy') {
          const json = settingsToJson(this.settings);
          try {
            await navigator.clipboard.writeText(json);
            el.textContent = 'Copied';
            setTimeout(() => {
              el.textContent = 'Copy settings JSON';
            }, 1200);
          } catch {
            el.textContent = 'Copy failed';
          }
        }
      });
    });

    this.root
      .querySelectorAll<HTMLInputElement>('input[data-play="masterVolume"]')
      .forEach((input) => {
        const handler = () => {
          this.play = savePlayPreferences({ ...this.play, masterVolume: Number(input.value) });
          const valueEl = this.root.querySelector('[data-value-for="masterVolume"]');
          if (valueEl) valueEl.textContent = this.play.masterVolume.toFixed(2);
        };
        input.addEventListener('input', handler);
        input.addEventListener('change', handler);
      });

    this.root.querySelectorAll<HTMLInputElement>('input[data-play-flag]').forEach((input) => {
      input.addEventListener('change', () => {
        const field = input.dataset.playFlag;
        if (field === 'captions' || field === 'pauseOnBlur') {
          this.play = savePlayPreferences({ ...this.play, [field]: input.checked });
        }
      });
    });

    this.root.querySelectorAll<HTMLSelectElement>('select[data-play]').forEach((select) => {
      select.addEventListener('change', () => {
        const field = select.dataset.play;
        if (field === 'reducedMotion' || field === 'quality') {
          this.play = savePlayPreferences({ ...this.play, [field]: select.value });
        }
      });
    });

    this.root.querySelectorAll<HTMLInputElement>('input[data-field]').forEach((input) => {
      const handler = () => {
        const field = input.dataset.field!;
        this.settings = { ...this.settings, preset: 'custom' };
        if (field in this.settings.atmosphere) {
          this.settings.atmosphere = {
            ...this.settings.atmosphere,
            [field]: input.type === 'checkbox' ? input.checked : Number(input.value),
          };
        } else if (field in this.settings.ocean) {
          const value = input.type === 'color' ? input.value : Number(input.value);
          this.settings.ocean = { ...this.settings.ocean, [field]: value };
        } else if (field in this.settings.environment) {
          this.settings.environment = {
            ...this.settings.environment,
            [field]: input.value,
          };
        } else if (field in this.settings.presentation) {
          const value = input.type === 'checkbox' ? input.checked : Number(input.value);
          this.settings.presentation = { ...this.settings.presentation, [field]: value };
        }
        const valueEl = this.root.querySelector(`[data-value-for="${field}"]`);
        if (valueEl && input.type !== 'checkbox' && input.type !== 'color') {
          const step = Number(input.step) || 0.01;
          valueEl.textContent = Number(input.value).toFixed(step < 0.01 ? 4 : step >= 1 ? 0 : 2);
        }
        this.emit();
      };
      input.addEventListener('input', handler);
      input.addEventListener('change', handler);
    });
  }
}

function slider(
  field: string,
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  scope: 'field' | 'play' = 'field',
): string {
  const digits = step < 0.01 ? 4 : step >= 1 ? 0 : 2;
  const attr = scope === 'play' ? 'data-play' : 'data-field';
  return `
    <label class="field">
      <span class="field-label"><span>${label}</span><span data-value-for="${field}">${value.toFixed(digits)}</span></span>
      <input type="range" ${attr}="${field}" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}" />
    </label>
  `;
}

function choice(
  field: string,
  label: string,
  value: string,
  options: ReadonlyArray<readonly [string, string]>,
): string {
  const opts = options
    .map(([id, text]) => `<option value="${id}"${id === value ? ' selected' : ''}>${text}</option>`)
    .join('');
  return `
    <label class="field">
      <span class="field-label">${label}</span>
      <select data-play="${field}" aria-label="${label}">${opts}</select>
    </label>
  `;
}

function colorField(field: string, label: string, value: string): string {
  return `
    <label class="field color">
      <span class="field-label">${label}</span>
      <input type="color" data-field="${field}" value="${value}" aria-label="${label}" />
    </label>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
