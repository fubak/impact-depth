import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import manifest from '../../public/assets/manifest.json';
import { GameAudio, cueDistanceGain, mapEngineMix } from '../../src/game/audio/audio';
import type { GamePhase, GameState } from '../../src/game/sim/types';

const shippedWavs = Object.keys(import.meta.glob('../../public/assets/audio/*.wav', { eager: true })).map(
  (path) => path.replace(/^.*\//, ''),
);

type Automation = {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
};

type MockNode = {
  kind?: 'gain' | 'buffer' | 'oscillator' | 'biquad';
  type?: OscillatorType | BiquadFilterType;
  frequency: Automation;
  playbackRate: Automation;
  buffer: AudioBuffer | null;
  loop: boolean;
  gain: Automation;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  destination?: MockNode;
};

function createAutomation(value = 0): Automation {
  return {
    value,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
}

function createPlayingState(
  overrides: { phase?: GamePhase; speed?: number; maxSpeed?: number } = {},
): GameState {
  return {
    phase: overrides.phase ?? 'playing',
    torpedoes: [],
    countermeasures: [],
    sonarPing: 0,
    stats: { shipsSunk: 0, powerupsTaken: 0 },
    submarine: { hp: 100, speed: overrides.speed ?? 0, maxSpeed: overrides.maxSpeed ?? 2.4 },
  } as unknown as GameState;
}

function walksToBiquad(node: MockNode): boolean {
  let current: MockNode | undefined = node;
  const seen = new Set<MockNode>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current.kind === 'biquad') return true;
    current = current.destination;
  }
  return false;
}

function engineLoopSources(nodes: MockNode[]): MockNode[] {
  return nodes.filter(
    (node) => node.start.mock.calls.length > 0 && walksToBiquad(node),
  );
}

function lastRampTarget(param: Automation): number | undefined {
  const calls = param.linearRampToValueAtTime.mock.calls;
  if (calls.length === 0) return undefined;
  return calls[calls.length - 1]?.[0] as number;
}

function installAudioMocks() {
  const nodes: MockNode[] = [];
  const deferred = new Set<string>();
  const immediate = new Set<string>();
  const resolvers = new Map<string, (response: Response) => void>();

  const context = {
    currentTime: 0,
    destination: { connect: vi.fn() },
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    decodeAudioData: vi.fn(async () => ({ duration: 2 }) as AudioBuffer),
    createGain: vi.fn(() => {
      const node: MockNode = {
        kind: 'gain',
        frequency: createAutomation(),
        playbackRate: createAutomation(1),
        buffer: null,
        loop: false,
        gain: createAutomation(),
        connect: vi.fn(function (this: MockNode, target: MockNode) {
          this.destination = target;
          return target;
        }),
        start: vi.fn(),
        stop: vi.fn(),
      };
      nodes.push(node);
      return node;
    }),
    createBufferSource: vi.fn(() => {
      const node: MockNode = {
        kind: 'buffer',
        frequency: createAutomation(),
        playbackRate: createAutomation(1),
        buffer: null,
        loop: false,
        gain: createAutomation(),
        connect: vi.fn(function (this: MockNode, target: MockNode) {
          this.destination = target;
          return target;
        }),
        start: vi.fn(),
        stop: vi.fn(),
      };
      nodes.push(node);
      return node;
    }),
    createOscillator: vi.fn(() => {
      const node: MockNode = {
        kind: 'oscillator',
        type: 'sine',
        frequency: createAutomation(),
        playbackRate: createAutomation(1),
        buffer: null,
        loop: false,
        gain: createAutomation(),
        connect: vi.fn(function (this: MockNode, target: MockNode) {
          this.destination = target;
          return target;
        }),
        start: vi.fn(),
        stop: vi.fn(),
      };
      nodes.push(node);
      return node;
    }),
    createBiquadFilter: vi.fn(() => {
      const node: MockNode = {
        kind: 'biquad',
        type: 'lowpass',
        frequency: createAutomation(),
        playbackRate: createAutomation(1),
        buffer: null,
        loop: false,
        gain: createAutomation(),
        connect: vi.fn(function (this: MockNode, target: MockNode) {
          this.destination = target;
          return target;
        }),
        start: vi.fn(),
        stop: vi.fn(),
      };
      nodes.push(node);
      return node;
    }),
  };

  vi.stubGlobal(
    'AudioContext',
    vi.fn(function MockAudioContext() {
      return context;
    }),
  );

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      const match = url.match(/\/([^/]+)\.wav$/);
      const name = match?.[1];
      if (name && immediate.has(name)) {
        return new Response(new ArrayBuffer(8), { status: 200 });
      }
      if (name && deferred.has(name)) {
        return new Promise<Response>((resolve) => {
          resolvers.set(name, resolve);
        });
      }
      return new Response(null, { status: 404 });
    }),
  );

  return {
    context,
    nodes,
    deferBank(name: string) {
      deferred.add(name);
    },
    loadBankImmediately(name: string) {
      immediate.add(name);
    },
    resolveBank(name: string) {
      const resolve = resolvers.get(name);
      if (resolve) {
        resolve(new Response(new ArrayBuffer(8), { status: 200 }));
        resolvers.delete(name);
      }
    },
    failBank(name: string) {
      const resolve = resolvers.get(name);
      if (resolve) {
        resolve(new Response(null, { status: 500 }));
        resolvers.delete(name);
      }
    },
    async flushLoads(audio?: GameAudio) {
      if (audio) await audio.settleBankLoads();
      else {
        await Promise.resolve();
        await Promise.resolve();
      }
    },
  };
}

describe('GameAudio', () => {
  it('constructs without a WebAudio context and defaults to unmuted', () => {
    const audio = new GameAudio();
    expect(audio.isMuted).toBe(false);
    expect(audio.getDiagnostics()).toEqual({
      unlocked: false,
      muted: false,
      contextState: 'none',
      banksLoaded: 0,
      ambientUsingFallback: false,
      engineUsingFallback: false,
    });
  });

  it('setMuted toggles isMuted without requiring unlock()', () => {
    const audio = new GameAudio();
    audio.setMuted(true);
    expect(audio.isMuted).toBe(true);
    audio.setMuted(false);
    expect(audio.isMuted).toBe(false);
  });

  it('dispose() is safe to call before unlock()', () => {
    const audio = new GameAudio();
    expect(() => audio.dispose()).not.toThrow();
  });
});

describe('GameAudio bank readiness', () => {
  let mocks: ReturnType<typeof installAudioMocks>;

  beforeEach(() => {
    mocks = installAudioMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts fallback ambient on first patrol then crossfades when ambient bank loads', async () => {
    mocks.deferBank('ambient');
    const audio = new GameAudio();
    audio.unlock();
    audio.observe(createPlayingState());

    expect(mocks.context.createOscillator).toHaveBeenCalled();
    expect(mocks.context.createBufferSource).not.toHaveBeenCalled();

    mocks.resolveBank('ambient');
    await audio.settleBankLoad('ambient');

    expect(mocks.context.createBufferSource).toHaveBeenCalled();
    expect(
      mocks.nodes.some((node) => node.gain.linearRampToValueAtTime.mock.calls.length > 0),
    ).toBe(true);
  });

  it('layers ambient2 after the primary authored bank is active', async () => {
    mocks.loadBankImmediately('ambient');
    mocks.deferBank('ambient2');
    const audio = new GameAudio();
    audio.unlock();
    await audio.settleBankLoad('ambient');
    audio.observe(createPlayingState());

    const sourcesBefore = mocks.context.createBufferSource.mock.calls.length;
    expect(sourcesBefore).toBeGreaterThan(0);
    mocks.resolveBank('ambient2');
    await audio.settleBankLoad('ambient2');

    expect(mocks.context.createBufferSource.mock.calls.length).toBeGreaterThan(sourcesBefore);
  });

  it('stopAmbient on pause clears fallback and authored sources', async () => {
    const audio = new GameAudio();
    audio.unlock();
    audio.observe(createPlayingState());
    const started = mocks.nodes.filter((node) => node.start.mock.calls.length > 0);
    expect(started.length).toBeGreaterThan(0);

    audio.observe({ ...createPlayingState(), phase: 'menu' } as GameState);
    for (const node of started) {
      expect(node.stop).toHaveBeenCalled();
    }
  });

  it('setMuted drives master gain without throwing during ambient playback', async () => {
    const audio = new GameAudio();
    audio.unlock();
    audio.setMuted(true);
    audio.observe(createPlayingState());
    const master = mocks.context.createGain.mock.results[0]?.value as MockNode;
    expect(master.gain.value).toBe(0);
  });

  it('dispose() during bank load prevents post-dispose ambient upgrade', async () => {
    mocks.deferBank('ambient');
    const audio = new GameAudio();
    audio.unlock();
    audio.observe(createPlayingState());
    const callsBeforeDispose = mocks.context.createBufferSource.mock.calls.length;
    audio.dispose();
    mocks.resolveBank('ambient');
    await audio.settleBankLoad('ambient');
    expect(mocks.context.createBufferSource.mock.calls.length).toBe(callsBeforeDispose);
  });

  it('keeps fallback ambient when bank fetch fails', async () => {
    mocks.deferBank('ambient');
    const audio = new GameAudio();
    audio.unlock();
    audio.observe(createPlayingState());
    mocks.failBank('ambient');
    await mocks.flushLoads(audio);
    expect(mocks.context.createOscillator).toHaveBeenCalled();
    expect(mocks.context.createBufferSource).not.toHaveBeenCalled();
  });
});

describe('mapEngineMix', () => {
  it('keeps playback rate, filter, and gain inside bounded ranges', () => {
    for (const speed of [-2, 0, 0.4, 1.2, 2.4, 12]) {
      const mix = mapEngineMix(speed, 2.4);
      expect(mix.playbackRate).toBeGreaterThanOrEqual(0.5);
      expect(mix.playbackRate).toBeLessThanOrEqual(1.6);
      expect(mix.filterHz).toBeGreaterThanOrEqual(80);
      expect(mix.filterHz).toBeLessThanOrEqual(2000);
      expect(mix.gain).toBeGreaterThanOrEqual(0);
      expect(mix.gain).toBeLessThanOrEqual(0.25);
    }
  });

  it('raises rate, filter cutoff, and gain as submarine speed increases', () => {
    const idle = mapEngineMix(0, 2.4);
    const flank = mapEngineMix(2.4, 2.4);
    expect(flank.playbackRate).toBeGreaterThan(idle.playbackRate);
    expect(flank.filterHz).toBeGreaterThan(idle.filterHz);
    expect(flank.gain).toBeGreaterThan(idle.gain);
  });
});

describe('GameAudio continuous engine layer', () => {
  let mocks: ReturnType<typeof installAudioMocks>;

  beforeEach(() => {
    mocks = installAudioMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts one synthesized engine loop while playing when the bank is absent', () => {
    const audio = new GameAudio();
    audio.unlock();
    audio.observe(createPlayingState());

    const loops = engineLoopSources(mocks.nodes);
    expect(loops).toHaveLength(1);
    expect(loops[0]?.kind).toBe('oscillator');
    expect(mocks.context.createBiquadFilter).toHaveBeenCalledTimes(1);
  });

  it('loops a single authored engine.wav bed once the bank is ready', async () => {
    mocks.loadBankImmediately('engine');
    const audio = new GameAudio();
    audio.unlock();
    await audio.settleBankLoad('engine');
    audio.observe(createPlayingState({ speed: 1.2 }));

    const loops = engineLoopSources(mocks.nodes);
    expect(loops).toHaveLength(1);
    expect(loops[0]?.kind).toBe('buffer');
    expect(loops[0]?.loop).toBe(true);
    expect(loops[0]?.playbackRate.value).toBeGreaterThanOrEqual(0.5);
    expect(loops[0]?.playbackRate.value).toBeLessThanOrEqual(1.6);
  });

  it('maps speed into bounded ramps without replacing the engine bed', async () => {
    mocks.loadBankImmediately('engine');
    const audio = new GameAudio();
    audio.unlock();
    await audio.settleBankLoad('engine');
    audio.observe(createPlayingState({ speed: 0 }));
    const [bed] = engineLoopSources(mocks.nodes);
    expect(bed).toBeDefined();

    audio.observe(createPlayingState({ speed: 2.2 }));

    expect(bed?.stop).not.toHaveBeenCalled();
    expect(engineLoopSources(mocks.nodes).filter((node) => node.stop.mock.calls.length === 0)).toHaveLength(
      1,
    );

    const filter = mocks.nodes.find((node) => node.kind === 'biquad');
    const engineGain = filter?.destination;
    const rateTarget = lastRampTarget(bed!.playbackRate) ?? bed!.playbackRate.value;
    const filterTarget = lastRampTarget(filter!.frequency) ?? filter!.frequency.value;
    const gainTarget = lastRampTarget(engineGain!.gain) ?? engineGain!.gain.value;
    expect(rateTarget).toBeGreaterThanOrEqual(0.5);
    expect(rateTarget).toBeLessThanOrEqual(1.6);
    expect(filterTarget).toBeGreaterThanOrEqual(80);
    expect(filterTarget).toBeLessThanOrEqual(2000);
    expect(gainTarget).toBeGreaterThanOrEqual(0);
    expect(gainTarget).toBeLessThanOrEqual(0.25);
  });

  it('plays speed-change chatter without stopping the engine loop', () => {
    const audio = new GameAudio();
    audio.unlock();
    audio.observe(createPlayingState({ speed: 0 }));
    const [bed] = engineLoopSources(mocks.nodes);
    const startedBefore = mocks.nodes.filter((node) => node.start.mock.calls.length > 0).length;

    audio.observe(createPlayingState({ speed: 1.6 }));

    expect(bed?.stop).not.toHaveBeenCalled();
    expect(engineLoopSources(mocks.nodes)).toHaveLength(1);
    expect(mocks.nodes.filter((node) => node.start.mock.calls.length > 0).length).toBeGreaterThan(
      startedBefore,
    );
  });

  it('stops the engine loop on mute and restarts a single loop after unmute', () => {
    const audio = new GameAudio();
    audio.unlock();
    audio.observe(createPlayingState());
    const [first] = engineLoopSources(mocks.nodes);
    expect(first).toBeDefined();

    audio.setMuted(true);
    expect(first?.stop).toHaveBeenCalled();
    expect(engineLoopSources(mocks.nodes).filter((node) => node.stop.mock.calls.length === 0)).toHaveLength(
      0,
    );

    audio.setMuted(false);
    audio.observe(createPlayingState({ speed: 0.8 }));
    expect(engineLoopSources(mocks.nodes).filter((node) => node.stop.mock.calls.length === 0)).toHaveLength(
      1,
    );
  });

  it('stops the engine loop on result and dispose', () => {
    const audio = new GameAudio();
    audio.unlock();
    audio.observe(createPlayingState());
    const [bed] = engineLoopSources(mocks.nodes);
    expect(bed).toBeDefined();

    audio.observe(createPlayingState({ phase: 'gameover' }));
    expect(bed?.stop).toHaveBeenCalled();

    const audio2 = new GameAudio();
    audio2.unlock();
    audio2.observe(createPlayingState());
    const [live] = engineLoopSources(mocks.nodes).filter((node) => node.stop.mock.calls.length === 0);
    audio2.dispose();
    expect(live?.stop).toHaveBeenCalled();
  });

  it('crossfades the synthesized engine bed to the decoded bank without stacking loops', async () => {
    mocks.deferBank('engine');
    const audio = new GameAudio();
    audio.unlock();
    audio.observe(createPlayingState({ speed: 0.9 }));
    const [fallback] = engineLoopSources(mocks.nodes);
    expect(fallback?.kind).toBe('oscillator');

    mocks.resolveBank('engine');
    await audio.settleBankLoad('engine');

    expect(fallback?.stop).toHaveBeenCalled();
    const live = engineLoopSources(mocks.nodes).filter((node) => node.stop.mock.calls.length === 0);
    expect(live).toHaveLength(1);
    expect(live[0]?.kind).toBe('buffer');
    expect(live[0]?.loop).toBe(true);
  });
});

function toneGains(nodes: MockNode[], frequency?: number): number[] {
  return nodes
    .filter(
      (n) =>
        n.kind === 'oscillator' &&
        n.start.mock.calls.length > 0 &&
        (frequency === undefined || n.frequency.value === frequency),
    )
    .map((n) => n.destination?.gain.setValueAtTime.mock.calls[0]?.[0] as number)
    .filter((g) => typeof g === 'number');
}

describe('GameAudio combat cues', () => {
  let mocks: ReturnType<typeof installAudioMocks>;

  beforeEach(() => {
    mocks = installAudioMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('plays a nearby hit louder than a distant one so proximity reads as danger', () => {
    const audio = new GameAudio();
    audio.unlock();
    audio.playCue('hit', { distance: 5 });
    audio.playCue('hit', { distance: 60 });
    const [near, far] = toneGains(mocks.nodes, 90);
    expect(near).toBeGreaterThan(far as number);
    expect(cueDistanceGain(5)).toBeGreaterThan(cueDistanceGain(60));
  });

  it('scales cue loudness by intensity', () => {
    const audio = new GameAudio();
    audio.unlock();
    audio.playCue('launch', { intensity: 1 });
    audio.playCue('launch', { intensity: 0.25 });
    const [loud, soft] = toneGains(mocks.nodes, 120);
    expect(loud).toBeGreaterThan(soft as number);
  });

  it('plays one explosion when observe and playCue(sink) fire in the same frame', () => {
    const audio = new GameAudio();
    audio.unlock();
    const before = createPlayingState();
    audio.observe(before);
    const oscBefore = mocks.context.createOscillator.mock.calls.length;
    audio.playCue('sink');
    const after = createPlayingState();
    (after.stats as { shipsSunk: number }).shipsSunk = 1;
    audio.observe(after);
    expect(mocks.context.createOscillator.mock.calls.length - oscBefore).toBe(1);
  });

  it('still plays observe explosion when no cue preceded it', () => {
    const audio = new GameAudio();
    audio.unlock();
    audio.observe(createPlayingState());
    const oscBefore = mocks.context.createOscillator.mock.calls.length;
    const after = createPlayingState();
    (after.stats as { shipsSunk: number }).shipsSunk = 1;
    audio.observe(after);
    expect(mocks.context.createOscillator.mock.calls.length - oscBefore).toBe(1);
  });

  it('setTension(1) raises the pulse gain and returns it to zero at setTension(0)', () => {
    const audio = new GameAudio();
    audio.unlock();
    audio.setTension(0);
    audio.setTension(1);
    const pulse = mocks.nodes.find((n) => n.kind === 'oscillator' && n.frequency.value === 55);
    expect(pulse).toBeDefined();
    const pulseGain = pulse?.destination as MockNode;
    expect(lastRampTarget(pulseGain.gain)).toBeGreaterThan(0);
    audio.setTension(0);
    expect(lastRampTarget(pulseGain.gain)).toBe(0);
  });
});

describe('audio bank ledger', () => {
  it('records provenance and fallback/production status for every shipped WAV', () => {
    expect(shippedWavs.length).toBeGreaterThan(0);
    expect(manifest.audioBanks).toBeDefined();

    for (const wav of shippedWavs) {
      const key = wav.replace(/\.wav$/, '');
      const entry = manifest.audioBanks[key as keyof typeof manifest.audioBanks];
      expect(entry, `${wav} missing audioBanks ledger entry`).toBeDefined();
      expect(entry.file).toBe(`audio/${wav}`);
      expect(entry.creator.length).toBeGreaterThan(0);
      expect(entry.source.length).toBeGreaterThan(0);
      expect(entry.license.length).toBeGreaterThan(0);
      expect(entry.cue.length).toBeGreaterThan(0);
      expect(entry.durationSec).toBeGreaterThan(0);
      expect(entry.status === 'fallback-generated' || entry.status === 'production-accepted').toBe(true);
    }
  });

  it('does not mark synthesized fallback banks as production-accepted', () => {
    const banks = Object.values(manifest.audioBanks);
    expect(banks.length).toBeGreaterThan(0);
    for (const entry of banks) {
      expect(entry.status).toBe('fallback-generated');
    }
    const audioLicense = manifest.licenseLedger.find((item) => item.id === 'procedural-audio-banks-v1');
    expect(audioLicense).toBeDefined();
    expect((audioLicense?.usage ?? '').toLowerCase()).toContain('fallback');
  });
});
