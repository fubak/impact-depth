import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameAudio } from '../../src/game/audio/audio';
import type { GameState } from '../../src/game/sim/types';

type MockNode = {
  type?: OscillatorType;
  frequency: { value: number };
  buffer: AudioBuffer | null;
  loop: boolean;
  gain: {
    value: number;
    setValueAtTime: ReturnType<typeof vi.fn>;
    linearRampToValueAtTime: ReturnType<typeof vi.fn>;
    exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  destination?: MockNode;
};

function createMockGain(): MockNode['gain'] {
  return {
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
}

function createPlayingState(): GameState {
  return {
    phase: 'playing',
    torpedoes: [],
    countermeasures: [],
    sonarPing: 0,
    stats: { shipsSunk: 0, powerupsTaken: 0 },
    submarine: { hp: 100, speed: 0 },
  } as unknown as GameState;
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
        frequency: { value: 0 },
        buffer: null,
        loop: false,
        gain: createMockGain(),
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
        frequency: { value: 0 },
        buffer: null,
        loop: false,
        gain: createMockGain(),
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
        type: 'sine',
        frequency: { value: 0 },
        buffer: null,
        loop: false,
        gain: createMockGain(),
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
