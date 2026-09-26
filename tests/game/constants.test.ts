import { expect, it } from 'vitest';
import * as constants from '../../src/game/sim/constants';

it('exports PRD numeric constants', () => {
  expect(constants).toMatchObject({
    WORLD_SIZE: 128,
    LAND_LEVEL: 0.78,
    FOB_RADIUS: 4.8,
    VICTORY_TARGET: 8,
    DEFAULT_CRUISE: 0.85,
    DC_ENGAGE_RANGE: 4.2,
    THERMOCLINE: 0.48,
    ACTIVE_PING_RANGE: 22,
    ACTIVE_PING_DURATION: 4.8,
    ACTIVE_COOLDOWN: 6.5,
    DAY_LENGTH: 480,
    SEAMOUNT_CRUSH_DPS: 18,
    FIRE_MAX_DEPTH: 0.8,
  });
});
