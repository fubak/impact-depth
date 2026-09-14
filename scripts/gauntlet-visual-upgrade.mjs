#!/usr/bin/env node
/**
 * Parent visual-upgrade gauntlet. Finite stations. Stops on first hard fail.
 * Sub-loops: combat-vfx, foam-spray, lighting, weather-coupling.
 * Does not self-approve GPU/lighting ACCEPT.
 *
 *   node scripts/gauntlet-visual-upgrade.mjs
 *   node scripts/gauntlet-visual-upgrade.mjs --browser [url]
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const browser = process.argv.includes('--browser');
const url = process.argv.find((arg) => arg.startsWith('http')) || 'http://127.0.0.1:8080/';

/** @type {{ name: string, files: string }[]} */
const unitStations = [
  { name: 'combat-vfx', files: 'tests/render/vfx.test.ts' },
  { name: 'foam-spray', files: 'tests/render/world-foam.test.ts tests/render/foam.test.ts' },
  { name: 'lighting', files: 'tests/render/hull-materials.test.ts tests/render/sky-lighting.test.ts' },
  { name: 'weather', files: 'tests/render/weather.test.ts tests/render/surface-effects.test.ts' },
];

function run(name, command, args) {
  console.log(`\n== ${name} ==`);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    console.error(`FAIL ${name}`);
    process.exit(result.status ?? 1);
  }
  console.log(`PASS ${name}`);
}

for (const station of unitStations) {
  run(station.name, 'npx', ['vitest', 'run', ...station.files.split(' ')]);
}

if (browser) {
  run('presentation-browser', 'node', ['scripts/gauntlet-presentation.mjs', url]);
}

console.log(JSON.stringify({ ok: true, stations: unitStations.map((s) => s.name), browser }, null, 2));
