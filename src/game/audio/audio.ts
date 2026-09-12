import type { GameState } from '../sim/types';

type BankName =
  | 'click'
  | 'torpedo'
  | 'explosion'
  | 'sonar'
  | 'countermeasure'
  | 'alarm'
  | 'pickup'
  | 'engine'
  | 'ambient'
  | 'ambient2';

const BANK_NAMES: readonly BankName[] = [
  'click',
  'torpedo',
  'explosion',
  'sonar',
  'countermeasure',
  'alarm',
  'pickup',
  'engine',
  'ambient',
  'ambient2',
];

/**
 * Small, dependency-free WebAudio bus. Audio is strictly observational: it never changes
 * simulation state. Authored PCM banks (`public/assets/audio/*.wav`) are loaded lazily on
 * unlock; every cue falls back to the original synthesized tone/oscillator if a bank is
 * missing, still loading, or fails to decode (offline dev, CI, broken CDN asset, etc.).
 */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientSource: AudioBufferSourceNode | OscillatorNode | null = null;
  /** Optional second ambient texture layered on top of `ambient.wav` when authored; never required. */
  private ambientLayerSource: AudioBufferSourceNode | null = null;
  private muted = false;
  private lastEngine = 0;
  private previous: GameState | null = null;
  private readonly banks = new Map<BankName, AudioBuffer>();
  private banksRequested = false;

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.22;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  unlock(): void {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.22;
      this.master.connect(this.context.destination);
    }
    void this.context.resume();
    if (!this.banksRequested) {
      this.banksRequested = true;
      void this.loadBanks();
    }
  }

  private async loadBanks(): Promise<void> {
    await Promise.all(BANK_NAMES.map((name) => this.loadBank(name)));
  }

  /** Fetch + decode a single bank. Never throws: missing/broken files simply keep the tone fallback. */
  private async loadBank(name: BankName): Promise<void> {
    if (!this.context) return;
    try {
      const response = await fetch(`/assets/audio/${name}.wav`);
      if (!response.ok) return;
      const data = await response.arrayBuffer();
      const buffer = await this.context.decodeAudioData(data);
      this.banks.set(name, buffer);
    } catch {
      // Missing file, offline dev, or unsupported codec: procedural tone fallback stays active.
    }
  }

  startAmbient(): void {
    if (!this.context || this.ambientSource) return;
    const buffer = this.banks.get('ambient');
    if (buffer) {
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = this.context.createGain();
      gain.gain.value = 0.5;
      source.connect(gain).connect(this.master!);
      source.start();
      this.ambientSource = source;
      this.startAmbientLayer();
      return;
    }
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 48;
    gain.gain.value = 0.025;
    oscillator.connect(gain).connect(this.master!);
    oscillator.start();
    this.ambientSource = oscillator;
  }

  /** Layers `ambient2.wav` under the primary ambient loop if that bank loaded; otherwise a no-op. */
  private startAmbientLayer(): void {
    if (!this.context || !this.master || this.ambientLayerSource) return;
    const buffer = this.banks.get('ambient2');
    if (!buffer) return;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.context.createGain();
    gain.gain.value = 0.25;
    source.connect(gain).connect(this.master);
    source.start();
    this.ambientLayerSource = source;
  }

  stopAmbient(): void {
    this.ambientSource?.stop();
    this.ambientSource = null;
    this.ambientLayerSource?.stop();
    this.ambientLayerSource = null;
  }

  sfxClick(): void { this.playBankOrTone('click', 680, 0.035, 'square', 0.05); }
  sfxTorpedo(): void { this.playBankOrTone('torpedo', 120, 0.18, 'sawtooth', 0.18); }
  sfxExplosion(): void { this.playBankOrTone('explosion', 62, 0.36, 'sawtooth', 0.3); }
  sfxSonar(): void { this.playBankOrTone('sonar', 920, 0.42, 'sine', 0.14); }
  sfxCountermeasure(): void { this.playBankOrTone('countermeasure', 260, 0.16, 'triangle', 0.12); }
  sfxAlarm(): void { this.playBankOrTone('alarm', 370, 0.13, 'square', 0.11); }
  sfxPickup(): void { this.playBankOrTone('pickup', 720, 0.15, 'sine', 0.12); }

  observe(game: GameState): void {
    const before = this.previous;
    if (game.phase === 'playing') this.startAmbient();
    else this.stopAmbient();
    if (before) {
      if (game.torpedoes.length > before.torpedoes.length) this.sfxTorpedo();
      if (game.countermeasures.length > before.countermeasures.length) this.sfxCountermeasure();
      if (game.sonarPing > before.sonarPing) this.sfxSonar();
      if (game.stats.shipsSunk > before.stats.shipsSunk) this.sfxExplosion();
      if (game.stats.powerupsTaken > before.stats.powerupsTaken) this.sfxPickup();
      if (game.submarine.hp < before.submarine.hp && game.submarine.hp < 35) this.sfxAlarm();
      const now = performance.now();
      if (now - this.lastEngine > 90 && Math.abs(game.submarine.speed - before.submarine.speed) > 0.03) {
        this.lastEngine = now;
        this.playBankOrTone('engine', 90 + game.submarine.speed * 35, 0.06, 'sine', 0.035);
      }
    }
    this.previous = game;
  }

  dispose(): void {
    this.stopAmbient();
    void this.context?.close();
  }

  /** Play the authored bank if loaded/decoded; otherwise fall back to the synthesized tone. */
  private playBankOrTone(
    bank: BankName,
    frequency: number,
    duration: number,
    type: OscillatorType,
    gainValue: number,
  ): void {
    if (!this.context || this.muted || !this.master) return;
    const buffer = this.banks.get(bank);
    if (buffer) {
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      const gain = this.context.createGain();
      gain.gain.value = gainValue;
      source.connect(gain).connect(this.master);
      source.start();
      return;
    }
    this.tone(frequency, duration, type, gainValue);
  }

  private tone(frequency: number, duration: number, type: OscillatorType, gainValue: number): void {
    if (!this.context || this.muted || !this.master) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(gainValue, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start();
    oscillator.stop(this.context.currentTime + duration);
  }
}
