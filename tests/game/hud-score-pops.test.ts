import { describe, expect, it } from 'vitest';
import { formatScorePops } from '../../src/ui/hud';
import type { GameMessage } from '../../src/game/sim/types';

describe('formatScorePops', () => {
  it('returns null label when no messages match', () => {
    const messages: GameMessage[] = [];
    const seen = new Set<string>();
    const result = formatScorePops(messages, seen);
    expect(result.label).toBeNull();
    expect(result.newIds).toEqual([]);
  });

  it('returns null label when all matching ids are already seen', () => {
    const messages: GameMessage[] = [
      { id: 'hit-1', text: 'HIT · Merchant Ship', ttl: 2.8 },
    ];
    const seen = new Set(['hit-1']);
    const result = formatScorePops(messages, seen);
    expect(result.label).toBeNull();
    expect(result.newIds).toEqual([]);
  });

  it('formats single HIT message', () => {
    const messages: GameMessage[] = [
      { id: 'hit-1', text: 'HIT · Merchant Ship', ttl: 2.8 },
    ];
    const seen = new Set<string>();
    const result = formatScorePops(messages, seen);
    expect(result.label).toBe('+1 HIT');
    expect(result.newIds).toEqual(['hit-1']);
  });

  it('formats multiple HIT messages', () => {
    const messages: GameMessage[] = [
      { id: 'hit-1', text: 'HIT · Merchant Ship', ttl: 2.8 },
      { id: 'hit-2', text: 'HIT · Destroyer', ttl: 2.8 },
    ];
    const seen = new Set<string>();
    const result = formatScorePops(messages, seen);
    expect(result.label).toBe('+2 HIT');
    expect(result.newIds).toEqual(['hit-1', 'hit-2']);
  });

  it('counts only new HIT ids when mixed with seen ids', () => {
    const messages: GameMessage[] = [
      { id: 'hit-1', text: 'HIT · Merchant Ship', ttl: 2.8 },
      { id: 'hit-2', text: 'HIT · Destroyer', ttl: 2.8 },
    ];
    const seen = new Set(['hit-1']);
    const result = formatScorePops(messages, seen);
    expect(result.label).toBe('+1 HIT');
    expect(result.newIds).toEqual(['hit-2']);
  });

  it('formats SHIP SUNK message', () => {
    const messages: GameMessage[] = [
      { id: 'sunk-100', text: 'SHIP SUNK', ttl: 6 },
    ];
    const seen = new Set<string>();
    const result = formatScorePops(messages, seen);
    expect(result.label).toBe('+1 SUNK');
    expect(result.newIds).toEqual(['sunk-100']);
  });

  it('formats SECTOR CLEARED message as a sink', () => {
    const messages: GameMessage[] = [
      { id: 'sunk-200', text: 'SECTOR CLEARED', ttl: 6 },
    ];
    const seen = new Set<string>();
    const result = formatScorePops(messages, seen);
    expect(result.label).toBe('+1 SUNK');
    expect(result.newIds).toEqual(['sunk-200']);
  });

  it('formats mixed HIT and SUNK messages', () => {
    const messages: GameMessage[] = [
      { id: 'hit-1', text: 'HIT · Merchant Ship', ttl: 2.8 },
      { id: 'hit-2', text: 'HIT · Destroyer', ttl: 2.8 },
      { id: 'sunk-100', text: 'SHIP SUNK', ttl: 6 },
    ];
    const seen = new Set<string>();
    const result = formatScorePops(messages, seen);
    expect(result.label).toBe('+2 HIT / +1 SUNK');
    expect(result.newIds).toEqual(['hit-1', 'hit-2', 'sunk-100']);
  });

  it('ignores messages that are not HIT or SUNK', () => {
    const messages: GameMessage[] = [
      { id: 'depth-50', text: 'DEPTH SURFACE', ttl: 1.6 },
      { id: 'deck-51', text: 'DECK GUN → Merchant', ttl: 1.8 },
      { id: 'hit-1', text: 'HIT · Destroyer', ttl: 2.8 },
    ];
    const seen = new Set<string>();
    const result = formatScorePops(messages, seen);
    expect(result.label).toBe('+1 HIT');
    expect(result.newIds).toEqual(['hit-1']);
  });

  it('handles breaking up ship (HIT text with BREAKING UP)', () => {
    const messages: GameMessage[] = [
      { id: 'hit-1', text: 'HIT · Destroyer BREAKING UP', ttl: 2.8 },
    ];
    const seen = new Set<string>();
    const result = formatScorePops(messages, seen);
    expect(result.label).toBe('+1 HIT');
    expect(result.newIds).toEqual(['hit-1']);
  });

  it('deduplicates correctly with multiple sinks', () => {
    const messages: GameMessage[] = [
      { id: 'sunk-100', text: 'SHIP SUNK', ttl: 6 },
      { id: 'sunk-200', text: 'SECTOR CLEARED', ttl: 6 },
    ];
    const seen = new Set<string>();
    const result = formatScorePops(messages, seen);
    expect(result.label).toBe('+2 SUNK');
    expect(result.newIds).toEqual(['sunk-100', 'sunk-200']);
  });
});
