#!/usr/bin/env node
/**
 * Fleet model gauntlet: waterline analysis + triangle density per class.
 *   node scripts/gauntlet-fleet-models.mjs
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(
  'npx',
  ['vitest', 'run', 'tests/render/fleet-waterline.test.ts'],
  { cwd: root, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
