import { describe, expect, it } from 'vitest';
import { GameAudio } from '../../src/game/audio/audio';

// jsdom/node test environments have no AudioContext; GameAudio only touches it lazily
// inside unlock(), so construction and mute state must stay safe without one.
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
