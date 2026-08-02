import type { GameState } from '../sim/types';

/** Small, dependency-free WebAudio bus. Audio is strictly observational: it never changes simulation state. */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambient: OscillatorNode | null = null;
  private muted = false;
  private lastEngine = 0;
  private previous: GameState | null = null;

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
  }

  startAmbient(): void {
    if (!this.context || this.ambient) return;
    this.ambient = this.context.createOscillator();
    const gain = this.context.createGain();
    this.ambient.type = 'sine';
    this.ambient.frequency.value = 48;
    gain.gain.value = 0.025;
    this.ambient.connect(gain).connect(this.master!);
    this.ambient.start();
  }

  stopAmbient(): void {
    this.ambient?.stop();
    this.ambient = null;
  }

  sfxClick(): void { this.tone(680, 0.035, 'square', 0.05); }
  sfxTorpedo(): void { this.tone(120, 0.18, 'sawtooth', 0.18); }
  sfxExplosion(): void { this.tone(62, 0.36, 'sawtooth', 0.3); }
  sfxSonar(): void { this.tone(920, 0.42, 'sine', 0.14); }
  sfxCountermeasure(): void { this.tone(260, 0.16, 'triangle', 0.12); }
  sfxAlarm(): void { this.tone(370, 0.13, 'square', 0.11); }
  sfxPickup(): void { this.tone(720, 0.15, 'sine', 0.12); }

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
        this.tone(90 + game.submarine.speed * 35, 0.06, 'sine', 0.035);
      }
    }
    this.previous = game;
  }

  dispose(): void {
    this.stopAmbient();
    void this.context?.close();
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
