#!/usr/bin/env node
/**
 * Generates project-owned mono WAV samples for the game's audio bank.
 *
 * These are synthesized in-process from layered oscillators (sine/square/
 * triangle/sawtooth) and filtered noise bursts — nothing scraped or licensed
 * from third parties. Each cue combines a handful of sound sources (tonal
 * fundamental + harmonic + shaped noise) so authored playback sounds richer
 * than the single-oscillator WebAudio tone fallbacks in
 * `src/game/audio/audio.ts`, while still landing in the same pitch/duration
 * neighborhood so the fallback feels like a family member, not a mismatch.
 * Regenerate with `npm run audio:banks`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'assets', 'audio');

/** Deterministic PRNG (mulberry32) so regeneration is reproducible. */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sine = (freq, t, phase = 0) => Math.sin(2 * Math.PI * freq * t + phase);
const square = (freq, t) => (sine(freq, t) >= 0 ? 1 : -1);
const sawtooth = (freq, t) => 2 * (((t * freq) % 1) - 0.5);
const triangle = (freq, t) => 2 * Math.abs(2 * (((t * freq) % 1) - 0.5)) - 1;

/** Exponential decay envelope, mirroring `gain.exponentialRampToValueAtTime` in audio.ts. */
function expDecay(t, duration, floor = 0.001) {
  if (t < 0) return 0;
  const ratio = Math.max(0, Math.min(1, t / duration));
  return Math.pow(floor, ratio);
}

/** Stateful one-pole low-pass filter (cheap IIR smoother) used to shape white noise into hiss/rumble. */
function onePole(alpha) {
  let state = 0;
  return (x) => {
    state += (x - state) * alpha;
    return state;
  };
}

/**
 * Stateful filtered-noise source: exposes both a slow "rumble" component and a
 * band-limited "hiss/rush" component (difference of two low-pass taps) derived
 * from the same underlying white noise stream, so callers can mix either or both.
 */
function makeNoiseTaps(seed, fastAlpha, slowAlpha) {
  const rng = makeRng(seed);
  const fast = onePole(fastAlpha);
  const slow = onePole(slowAlpha);
  return () => {
    const white = rng() * 2 - 1;
    const lowpassed = slow(white);
    const band = fast(white) - lowpassed;
    return { white, low: lowpassed, band };
  };
}

/** Linear fade in/out at the sample edges to avoid clicks (esp. for loop points). */
function edgeFade(samples, sampleRate, fadeSeconds) {
  const fadeSamples = Math.min(samples.length >> 1, Math.round(fadeSeconds * sampleRate));
  for (let i = 0; i < fadeSamples; i++) {
    const g = i / fadeSamples;
    samples[i] *= g;
    samples[samples.length - 1 - i] *= g;
  }
}

function normalize(samples, peak = 0.92) {
  let max = 0;
  for (const s of samples) max = Math.max(max, Math.abs(s));
  if (max <= 1e-9) return;
  const scale = peak / max;
  for (let i = 0; i < samples.length; i++) samples[i] *= scale;
}

function toWavBuffer(samples, sampleRate) {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // fmt chunk size (PCM)
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28); // byte rate
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buffer;
}

function synth(name, sampleRate, duration, gen) {
  const count = Math.round(sampleRate * duration);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) samples[i] = gen(i / sampleRate, i, count);
  return { name, sampleRate, samples };
}

const SR = 22050;

const banks = [];

// click.wav — UI blip: square body (matches sfxClick 680Hz) + an octave-up sine tick for
// definition + a sub-8ms noise transient for a percussive "attack" edge.
banks.push(
  (() => {
    const rng = makeRng(0x1c11c000);
    return synth('click', SR, 0.06, (t) => {
      const body = square(680, t) * expDecay(t, 0.03, 0.001);
      const overtone = sine(1360, t) * expDecay(t, 0.015, 0.001) * 0.35;
      const transient = (rng() * 2 - 1) * expDecay(t, 0.006, 0.0005) * 0.55;
      return body * 0.75 + overtone + transient;
    });
  })(),
);

// torpedo.wav — launch + run: descending sawtooth fundamental, a sub-octave sine for weight,
// and band-limited "water rush" noise (difference of two low-pass taps) for the wake trail.
banks.push(
  (() => {
    const taps = makeNoiseTaps(0x70720de0, 0.35, 0.04);
    return synth('torpedo', SR, 0.5, (t) => {
      const freq = 130 - t * 55;
      const fundamental = sawtooth(freq, t) * expDecay(t, 0.32, 0.002);
      const sub = sine(freq / 2, t) * expDecay(t, 0.36, 0.0015) * 0.5;
      const { band } = taps();
      const rush = band * expDecay(t, 0.42, 0.002) * 1.1;
      return fundamental * 0.55 + sub * 0.45 + rush * 0.55;
    });
  })(),
);

// explosion.wav — layered blast: sharp noise crack, a punchy sub-bass thump, a descending
// boom tone, and a slower filtered-noise rumble tail for underwater roll-off.
banks.push(
  (() => {
    const crackleRng = makeRng(0xe6510de1);
    const taps = makeNoiseTaps(0xe6510de2, 0.25, 0.03);
    return synth('explosion', SR, 1.0, (t) => {
      const crackle = (crackleRng() * 2 - 1) * expDecay(t, 0.05, 0.0008);
      const { band } = taps();
      const rumble = band * expDecay(t, 0.75, 0.001) * 0.85;
      const boomFreq = Math.max(20, 70 - t * 30);
      const boom = sine(boomFreq, t) * expDecay(t, 0.55, 0.0015) * 0.75;
      const subThump = sine(35, t) * expDecay(t, 0.18, 0.001) * 0.6;
      return crackle * 0.7 + rumble + boom + subThump;
    });
  })(),
);

// sonar.wav — ping: sine fundamental (matches sfxSonar 920Hz) + a quiet 2nd-harmonic
// overtone, a soft onset transient, and subtle tremolo for a "metallic" ring.
banks.push(
  (() => {
    const rng = makeRng(0x50a2000f);
    return synth('sonar', SR, 0.55, (t) => {
      const tremolo = 1 + 0.06 * sine(7, t);
      const fundamental = sine(920, t) * tremolo * expDecay(t, 0.48, 0.001);
      const overtone = sine(1840, t) * expDecay(t, 0.22, 0.001) * 0.25;
      const onset = (rng() * 2 - 1) * expDecay(t, 0.01, 0.0005) * 0.2;
      return fundamental + overtone + onset;
    });
  })(),
);

// countermeasure.wav — chaff pop: three quick triangle pops (decoy bursts) layered over a
// short filtered-noise hiss tail, matching sfxCountermeasure's 260Hz base tone.
banks.push(
  (() => {
    const taps = makeNoiseTaps(0xc0117e5e, 0.3, 0.05);
    const pops = [0, 0.07, 0.15];
    return synth('countermeasure', SR, 0.3, (t) => {
      let popSum = 0;
      for (const start of pops) {
        const dt = t - start;
        if (dt >= 0) popSum += triangle(260, dt) * expDecay(dt, 0.08, 0.002);
      }
      const { low } = taps();
      const hiss = low * expDecay(t, 0.24, 0.001) * 0.4;
      return popSum * 0.7 + hiss;
    });
  })(),
);

// alarm.wav — klaxon: square fundamental (matches sfxAlarm 370Hz) with duty pulsing, a
// perfect-fifth harmonic for body, and a slow pitch wobble for urgency.
banks.push(
  synth('alarm', SR, 0.2, (t) => {
    const wobble = 1 + 0.03 * sine(9, t);
    const freq = 370 * wobble;
    const pulse = sine(18, t) >= 0 ? 1 : 0.35;
    const fundamental = square(freq, t) * pulse * expDecay(t, 0.17, 0.004);
    const fifth = sine(freq * 1.5, t) * pulse * expDecay(t, 0.15, 0.004) * 0.3;
    return fundamental * 0.8 + fifth;
  }),
);

// pickup.wav — upward chirp (matches sfxPickup 720Hz sweep) with an octave-up overtone and
// a brief high-frequency "sparkle" transient at onset.
banks.push(
  (() => {
    const rng = makeRng(0x91c4b00e);
    return synth('pickup', SR, 0.22, (t) => {
      const freq = 720 + t * 950;
      const fundamental = sine(freq, t) * expDecay(t, 0.17, 0.003);
      const overtone = sine(freq * 2, t) * expDecay(t, 0.09, 0.002) * 0.25;
      const sparkle = (rng() * 2 - 1) * expDecay(t, 0.03, 0.001) * 0.18;
      return fundamental * 0.85 + overtone + sparkle;
    });
  })(),
);

// engine.wav — loopable hum: three-harmonic tonal stack (~90-125Hz band, matching the
// observe() engine blip range) with a slow amplitude throb and low-pass filtered rumble.
banks.push(
  (() => {
    const taps = makeNoiseTaps(0x9e3d1a02, 0.15, 0.02);
    const s = synth('engine', SR, 1.5, (t) => {
      const throb = 1 + 0.05 * sine(3.3, t);
      const hum = (sine(100, t) * 0.65 + sine(150, t) * 0.18 + sine(200, t) * 0.12) * throb;
      const { low } = taps();
      return hum + low * 0.12;
    });
    edgeFade(s.samples, s.sampleRate, 0.03);
    return s;
  })(),
);

// ambient.wav — deep-sea drone: fundamental + two harmonics with a slow "breathing"
// amplitude LFO, band-limited water hiss, and a couple of sparse low creak transients.
// 3.5s loop, well under the ~200KB budget at 22.05kHz mono 16-bit (~155KB).
const AMBIENT_DURATION = 3.5;
banks.push(
  (() => {
    const taps = makeNoiseTaps(0x5ea0f100, 0.4, 0.05);
    const creakStarts = [0.9, 2.1, 2.9];
    const s = synth('ambient', SR, AMBIENT_DURATION, (t) => {
      const breathe = 1 + 0.15 * sine(0.15, t);
      const drone = (sine(48, t) * 0.55 + sine(96, t) * 0.09 + sine(24, t) * 0.12) * breathe;
      const { low, band } = taps();
      const hiss = band * 0.4 + low * 0.35;
      let creak = 0;
      for (const start of creakStarts) {
        const dt = t - start;
        if (dt >= 0 && dt < 0.4) creak += sine(35 - dt * 20, dt) * expDecay(dt, 0.35, 0.002) * 0.22;
      }
      return drone + hiss + creak;
    });
    edgeFade(s.samples, s.sampleRate, 0.08);
    return s;
  })(),
);

// ambient2.wav — optional second ambient layer: a higher, slower-moving shimmer pad (two
// closely detuned sines for a subtle beating "distant machinery" feel) plus sparse quiet
// high sonar-glint transients. Mixed in at low gain by audio.ts on top of ambient.wav;
// entirely optional — startAmbient() only layers it in if the bank loaded successfully.
banks.push(
  (() => {
    const taps = makeNoiseTaps(0x2a361100, 0.2, 0.03);
    const glintStarts = [0.6, 1.8, 2.7];
    const s = synth('ambient2', SR, AMBIENT_DURATION, (t) => {
      const sway = 0.5 + 0.5 * sine(0.2, t);
      const pad = (sine(220, t) + sine(223, t)) * 0.15 * sway;
      const { low } = taps();
      const wash = low * 0.12;
      let glint = 0;
      for (const start of glintStarts) {
        const dt = t - start;
        if (dt >= 0 && dt < 0.3) glint += sine(1400 + dt * 200, dt) * expDecay(dt, 0.25, 0.002) * 0.12;
      }
      return pad + wash + glint;
    });
    edgeFade(s.samples, s.sampleRate, 0.08);
    return s;
  })(),
);

mkdirSync(OUT_DIR, { recursive: true });

let totalBytes = 0;
for (const bank of banks) {
  normalize(bank.samples);
  const buffer = toWavBuffer(bank.samples, bank.sampleRate);
  const path = join(OUT_DIR, `${bank.name}.wav`);
  writeFileSync(path, buffer);
  totalBytes += buffer.length;
  const kb = (buffer.length / 1024).toFixed(1);
  console.log(`wrote ${path} (${kb} KB)`);
}

console.log(`done: ${banks.length} banks, ${(totalBytes / 1024).toFixed(1)} KB total`);
