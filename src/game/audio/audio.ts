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

const AMBIENT_CROSSFADE_SEC = 1.5;
const AMBIENT_PRIMARY_GAIN = 0.5;
const AMBIENT_LAYER_GAIN = 0.25;
const AMBIENT_FALLBACK_GAIN = 0.025;
const ENGINE_MIX_RAMP_SEC = 0.08;
const DEFAULT_MAX_SPEED = 2.4;

export interface EngineMix {
  playbackRate: number;
  filterHz: number;
  gain: number;
}

/** Map submarine speed onto a bounded engine bed. Audio-only; never written back to sim. */
export function mapEngineMix(speed: number, maxSpeed = DEFAULT_MAX_SPEED): EngineMix {
  const span = Math.max(maxSpeed, 0.01);
  const t = Math.min(1, Math.max(0, speed / span));
  return {
    playbackRate: 0.72 + t * 0.56,
    filterHz: 180 + t * 820,
    gain: 0.035 + t * 0.09,
  };
}

function rampParam(param: AudioParam, value: number, now: number, seconds: number): void {
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + seconds);
}

/**
 * Small, dependency-free WebAudio bus. Audio is strictly observational: it never changes
 * simulation state. WAV banks (`public/assets/audio/*.wav`) are loaded lazily on unlock;
 * shipped files are fallback-generated until an operator listening pass marks them
 * production-accepted. Every cue falls back to a synthesized tone/oscillator if a bank is
 * missing, still loading, or fails to decode. When fallback ambient is already playing,
 * a successful bank decode crossfades to the loaded loop.
 */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ui: GainNode | null = null;
  private sfx: GainNode | null = null;
  private ambience: GainNode | null = null;
  private engineGroup: GainNode | null = null;
  private ambientSource: AudioBufferSourceNode | OscillatorNode | null = null;
  private ambientGain: GainNode | null = null;
  /** Optional second ambient texture layered on top of `ambient.wav` when loaded; never required. */
  private ambientLayerSource: AudioBufferSourceNode | null = null;
  private ambientUsingFallback = false;
  private ambientWantsPlaying = false;
  private engineSource: AudioBufferSourceNode | OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private engineUsingFallback = false;
  private engineWantsPlaying = false;
  private lastSpeed = 0;
  private lastMaxSpeed = DEFAULT_MAX_SPEED;
  private muted = false;
  private lastEngine = 0;
  private previous: GameState | null = null;
  private readonly banks = new Map<BankName, AudioBuffer>();
  private readonly bankLoads = new Set<Promise<void>>();
  private readonly bankLoadsByName = new Map<BankName, Promise<void>>();
  private banksRequested = false;
  private disposed = false;

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.22;
    if (muted) this.stopEngine();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  getDiagnostics(): {
    unlocked: boolean;
    muted: boolean;
    contextState: AudioContextState | 'none';
    banksLoaded: number;
    ambientUsingFallback: boolean;
    engineUsingFallback: boolean;
  } {
    return {
      unlocked: this.context !== null,
      muted: this.muted,
      contextState: this.context?.state ?? 'none',
      banksLoaded: this.banks.size,
      ambientUsingFallback: this.ambientUsingFallback,
      engineUsingFallback: this.engineUsingFallback,
    };
  }

  unlock(): void {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.22;
      this.master.connect(this.context.destination);
      this.ui = this.context.createGain();
      this.sfx = this.context.createGain();
      this.ambience = this.context.createGain();
      this.engineGroup = this.context.createGain();
      this.ui.connect(this.master);
      this.sfx.connect(this.master);
      this.ambience.connect(this.master);
      this.engineGroup.connect(this.master);
    }
    void this.context.resume();
    if (!this.banksRequested) {
      this.banksRequested = true;
      void this.loadBanks();
    }
  }

  private async loadBanks(): Promise<void> {
    await Promise.all(BANK_NAMES.map((name) => this.loadBank(name)));
    this.upgradeAmbientIfReady();
    this.upgradeEngineIfReady();
  }

  /** Await in-flight bank decode jobs (for deterministic tests). */
  async settleBankLoads(): Promise<void> {
    await Promise.all([...this.bankLoads]);
  }

  /** Await one named bank decode job (for deterministic tests). */
  async settleBankLoad(name: BankName): Promise<void> {
    const job = this.bankLoadsByName.get(name);
    if (job) await job;
  }

  /** Fetch + decode a single bank. Never throws: missing/broken files simply keep the tone fallback. */
  private async loadBank(name: BankName): Promise<void> {
    if (!this.context || this.disposed) return;
    const job = this.loadBankInner(name);
    this.bankLoads.add(job);
    this.bankLoadsByName.set(name, job);
    try {
      await job;
    } finally {
      this.bankLoads.delete(job);
      this.bankLoadsByName.delete(name);
    }
  }

  private async loadBankInner(name: BankName): Promise<void> {
    if (!this.context || this.disposed) return;
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}assets/audio/${name}.wav`);
      if (!response.ok) return;
      const data = await response.arrayBuffer();
      if (!this.context || this.disposed) return;
      const buffer = await this.context.decodeAudioData(data);
      if (!this.context || this.disposed) return;
      this.banks.set(name, buffer);
      if (name === 'ambient' || name === 'ambient2') {
        this.upgradeAmbientIfReady();
      }
      if (name === 'engine') {
        this.upgradeEngineIfReady();
      }
    } catch {
      // Missing file, offline dev, or unsupported codec: procedural tone fallback stays active.
    }
  }

  startAmbient(): void {
    if (!this.context || !this.master) return;
    this.ambientWantsPlaying = true;
    if (this.ambientSource) return;

    const buffer = this.banks.get('ambient');
    if (buffer) {
      this.startAuthoredAmbient(buffer);
      return;
    }

    this.startFallbackAmbient();
  }

  private startAuthoredAmbient(buffer: AudioBuffer): void {
    if (!this.context || !this.master) return;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.context.createGain();
    gain.gain.value = AMBIENT_PRIMARY_GAIN;
    source.connect(gain).connect(this.mix('ambience'));
    source.start();
    this.ambientSource = source;
    this.ambientGain = gain;
    this.ambientUsingFallback = false;
    this.startAmbientLayer();
  }

  private startFallbackAmbient(): void {
    if (!this.context || !this.master) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 48;
    gain.gain.value = AMBIENT_FALLBACK_GAIN;
    oscillator.connect(gain).connect(this.mix('ambience'));
    oscillator.start();
    this.ambientSource = oscillator;
    this.ambientGain = gain;
    this.ambientUsingFallback = true;
  }

  /** Crossfade fallback ambient to authored banks once decode completes. */
  private upgradeAmbientIfReady(): void {
    if (!this.context || !this.master || this.disposed || !this.ambientWantsPlaying) return;

    const ambientBuffer = this.banks.get('ambient');
    if (this.ambientUsingFallback && ambientBuffer && this.ambientSource) {
      this.crossfadeAmbientToAuthored(ambientBuffer);
      return;
    }

    if (!this.ambientUsingFallback && this.ambientSource && !this.ambientLayerSource) {
      this.startAmbientLayer();
    }
  }

  private crossfadeAmbientToAuthored(buffer: AudioBuffer): void {
    if (!this.context || !this.master) return;
    const oldSource = this.ambientSource;
    const oldGain = this.ambientGain;
    if (!this.ambientUsingFallback || !oldSource || !oldGain) return;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.context.createGain();
    gain.gain.value = 0;
    source.connect(gain).connect(this.mix('ambience'));
    source.start();

    const now = this.context.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(AMBIENT_PRIMARY_GAIN, now + AMBIENT_CROSSFADE_SEC);
    oldGain.gain.setValueAtTime(oldGain.gain.value, now);
    oldGain.gain.linearRampToValueAtTime(0.0001, now + AMBIENT_CROSSFADE_SEC);

    this.ambientSource = source;
    this.ambientGain = gain;
    this.ambientUsingFallback = false;

    try {
      oldSource.stop(now + AMBIENT_CROSSFADE_SEC);
    } catch {
      // Oscillator may already be stopped after dispose.
    }
    this.startAmbientLayer();
  }

  /** Layers `ambient2.wav` under the primary ambient loop if that bank loaded; otherwise a no-op. */
  private startAmbientLayer(): void {
    if (!this.context || !this.master || this.ambientLayerSource || this.ambientUsingFallback) return;
    const buffer = this.banks.get('ambient2');
    if (!buffer) return;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.context.createGain();
    gain.gain.value = AMBIENT_LAYER_GAIN;
    source.connect(gain).connect(this.mix('ambience'));
    source.start();
    this.ambientLayerSource = source;
  }

  stopAmbient(): void {
    this.ambientWantsPlaying = false;
    this.ambientSource?.stop();
    this.ambientSource = null;
    this.ambientGain = null;
    this.ambientLayerSource?.stop();
    this.ambientLayerSource = null;
    this.ambientUsingFallback = false;
  }

  sfxClick(): void { this.playBankOrTone('click', 680, 0.035, 'square', 0.05, 'ui'); }
  sfxTorpedo(): void { this.playBankOrTone('torpedo', 120, 0.18, 'sawtooth', 0.18, 'sfx'); }
  sfxExplosion(): void { this.playBankOrTone('explosion', 62, 0.36, 'sawtooth', 0.3, 'sfx'); }
  sfxSonar(): void { this.playBankOrTone('sonar', 920, 0.42, 'sine', 0.14, 'sfx'); }
  sfxCountermeasure(): void { this.playBankOrTone('countermeasure', 260, 0.16, 'triangle', 0.12, 'sfx'); }
  sfxAlarm(): void { this.playBankOrTone('alarm', 370, 0.13, 'square', 0.11, 'sfx'); }
  sfxPickup(): void { this.playBankOrTone('pickup', 720, 0.15, 'sine', 0.12, 'sfx'); }

  observe(game: GameState): void {
    const before = this.previous;
    this.lastSpeed = game.submarine.speed;
    this.lastMaxSpeed = game.submarine.maxSpeed > 0 ? game.submarine.maxSpeed : DEFAULT_MAX_SPEED;
    if (game.phase === 'playing') {
      this.startAmbient();
      this.syncEngineLayer();
    } else {
      this.stopAmbient();
      this.engineWantsPlaying = false;
      this.stopEngine();
    }
    if (before) {
      if (game.torpedoes.length > before.torpedoes.length) this.sfxTorpedo();
      if (game.countermeasures.length > before.countermeasures.length) this.sfxCountermeasure();
      if (game.sonarPing > before.sonarPing) this.sfxSonar();
      if (game.stats.shipsSunk > before.stats.shipsSunk) this.sfxExplosion();
      if (game.stats.powerupsTaken > before.stats.powerupsTaken) this.sfxPickup();
      if (game.submarine.hp < before.submarine.hp && game.submarine.hp < 35) this.sfxAlarm();
      if (
        game.phase === 'playing' &&
        !this.muted &&
        performance.now() - this.lastEngine > 90 &&
        Math.abs(game.submarine.speed - before.submarine.speed) > 0.03
      ) {
        this.lastEngine = performance.now();
        this.tone(90 + game.submarine.speed * 35, 0.06, 'sine', 0.035, 'sfx');
      }
    }
    this.previous = game;
  }

  dispose(): void {
    this.disposed = true;
    this.engineWantsPlaying = false;
    this.stopEngine();
    this.stopAmbient();
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.ui = null;
    this.sfx = null;
    this.ambience = null;
    this.engineGroup = null;
    this.banks.clear();
  }

  private mix(group: 'ui' | 'sfx' | 'ambience' | 'engine'): GainNode {
    const master = this.master;
    if (!master) throw new Error('audio mix used before unlock');
    switch (group) {
      case 'ui':
        return this.ui ?? master;
      case 'sfx':
        return this.sfx ?? master;
      case 'ambience':
        return this.ambience ?? master;
      case 'engine':
        return this.engineGroup ?? master;
      default: {
        const exhaustive: never = group;
        throw new Error(`unhandled mix group ${String(exhaustive)}`);
      }
    }
  }

  private syncEngineLayer(): void {
    this.engineWantsPlaying = true;
    if (this.muted || this.disposed) return;
    if (this.engineSource) {
      this.applyEngineMix();
      return;
    }
    this.startEngine();
  }

  private startEngine(): void {
    if (!this.context || !this.engineGroup || this.muted || this.disposed || this.engineSource) return;
    const mix = mapEngineMix(this.lastSpeed, this.lastMaxSpeed);
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = mix.filterHz;
    const gain = this.context.createGain();
    gain.gain.value = mix.gain;
    const buffer = this.banks.get('engine');
    if (buffer) {
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.playbackRate.value = mix.playbackRate;
      source.connect(filter).connect(gain).connect(this.engineGroup);
      source.start();
      this.engineSource = source;
      this.engineUsingFallback = false;
    } else {
      const oscillator = this.context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = 90 + this.lastSpeed * 35;
      oscillator.connect(filter).connect(gain).connect(this.engineGroup);
      oscillator.start();
      this.engineSource = oscillator;
      this.engineUsingFallback = true;
    }
    this.engineFilter = filter;
    this.engineGain = gain;
  }

  private applyEngineMix(): void {
    if (!this.context || !this.engineFilter || !this.engineGain || !this.engineSource) return;
    const mix = mapEngineMix(this.lastSpeed, this.lastMaxSpeed);
    const now = this.context.currentTime;
    rampParam(this.engineFilter.frequency, mix.filterHz, now, ENGINE_MIX_RAMP_SEC);
    rampParam(this.engineGain.gain, mix.gain, now, ENGINE_MIX_RAMP_SEC);
    if ('playbackRate' in this.engineSource) {
      rampParam(this.engineSource.playbackRate, mix.playbackRate, now, ENGINE_MIX_RAMP_SEC);
    }
    if (this.engineUsingFallback && 'frequency' in this.engineSource) {
      rampParam(this.engineSource.frequency, 90 + this.lastSpeed * 35, now, ENGINE_MIX_RAMP_SEC);
    }
  }

  private upgradeEngineIfReady(): void {
    if (!this.engineWantsPlaying || this.muted || this.disposed) return;
    if (!this.engineUsingFallback || !this.engineSource) return;
    if (!this.banks.get('engine')) return;
    this.stopEngine();
    this.startEngine();
  }

  private stopEngine(): void {
    try {
      this.engineSource?.stop();
    } catch {
      // Source may already be stopped after dispose or a previous mute.
    }
    this.engineSource = null;
    this.engineFilter = null;
    this.engineGain = null;
    this.engineUsingFallback = false;
  }

  /** Play the decoded bank if ready; otherwise fall back to the synthesized tone. */
  private playBankOrTone(
    bank: BankName,
    frequency: number,
    duration: number,
    type: OscillatorType,
    gainValue: number,
    group: 'ui' | 'sfx',
  ): void {
    if (!this.context || this.muted || !this.master) return;
    const buffer = this.banks.get(bank);
    if (buffer) {
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      const gain = this.context.createGain();
      gain.gain.value = gainValue;
      source.connect(gain).connect(this.mix(group));
      source.start();
      return;
    }
    this.tone(frequency, duration, type, gainValue, group);
  }

  private tone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    gainValue: number,
    group: 'ui' | 'sfx' = 'sfx',
  ): void {
    if (!this.context || this.muted || !this.master) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(gainValue, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + duration);
    oscillator.connect(gain).connect(this.mix(group));
    oscillator.start();
    oscillator.stop(this.context.currentTime + duration);
  }
}
