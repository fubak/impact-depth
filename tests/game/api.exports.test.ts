import { expect, it } from 'vitest';
import * as api from '../../src/game/sim/api';

it('exports every PRD section 15 API symbol', () => {
  for (const name of ['createGame', 'startMission', 'restartGame', 'setPhase', 'setWeapon', 'toggleDebugFacing', 'setDepthOrder', 'setSpeedOrder', 'toggleSilentRunning', 'toggleScope', 'toggleSnorkel', 'toggleTorpedoSpread', 'setAutopilot', 'cancelAutopilot', 'orderMove', 'selectTarget', 'clearEngagement', 'detachCamera', 'deployCountermeasure', 'fireWeapon', 'sonarPulse', 'updateGame', 'pickShipAt', 'pickShipAtScreen', 'findShip', 'snapToNavigable', 'applyHostSeed']) expect(api).toHaveProperty(name);
});
