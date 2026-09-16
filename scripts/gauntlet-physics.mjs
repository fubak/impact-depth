#!/usr/bin/env node
/**
 * Physics/presentation gauntlets: camera pivot, hull water, weapons, lighting.
 *   node scripts/gauntlet-physics.mjs
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stations = [
  { name: 'camera-pivot', files: ['tests/render/camera-underwater.test.ts', 'tests/render/bow-facing.test.ts'] },
  { name: 'hull-physics', files: ['tests/render/hull-physics.test.ts', 'tests/render/fleet-waterline.test.ts'] },
  { name: 'weapon-physics', files: ['tests/render/weapon-physics.test.ts'] },
  { name: 'lighting', files: ['tests/render/atmosphere-light.test.ts', 'tests/render/sky-lighting.test.ts'] },
];

for (const station of stations) {
  console.log(`\n== ${station.name} ==`);
  const result = spawnSync('npx', ['vitest', 'run', ...station.files], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`FAIL ${station.name}`);
    process.exit(result.status ?? 1);
  }
  console.log(`PASS ${station.name}`);
}
console.log(JSON.stringify({ ok: true, stations: stations.map((s) => s.name) }, null, 2));
