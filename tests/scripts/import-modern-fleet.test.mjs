import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateFleetSourceManifest } from '../../scripts/lib/fleet-source-manifest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');
const nodeBin = process.execPath;
const importScript = resolve(root, 'scripts/import-modern-fleet.mjs');
const fixtureManifest = resolve(root, 'tests/fixtures/fleet-import/manifest.json');
const productionManifest = resolve(root, 'config/fleet-source-manifest.json');

function sha256File(relPath) {
  const bytes = readFileSync(resolve(root, relPath));
  return createHash('sha256').update(bytes).digest('hex');
}

function runImport(args) {
  try {
    const stdout = execFileSync(nodeBin, [importScript, ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, status: 0 };
  } catch (err) {
    return {
      stdout: `${err.stdout ?? ''}${err.stderr ?? ''}`,
      status: err.status ?? 1,
    };
  }
}

describe('import-modern-fleet manifest contract', () => {
  it('loads @gltf-transform/functions on startup (dependency declared)', () => {
    const result = runImport(['--manifest', fixtureManifest, '--validate']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"ok": true');
  });

  it('validates the project-owned fixture manifest', () => {
    const validation = validateFleetSourceManifest(fixtureManifest, root);
    expect(validation.ok).toBe(true);
    expect(validation.entities).toHaveLength(1);
    expect(validation.entities[0]?.kind).toBe('torpedo');
  });

  it('fails early with actionable errors when production sources are missing', () => {
    const validation = validateFleetSourceManifest(productionManifest, root);
    expect(validation.ok).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
    expect(validation.errors.some((e) => e.includes('missing staged source'))).toBe(true);
    expect(validation.errors.some((e) => e.includes('manifest input:'))).toBe(true);
  });

  it('dry-run does not mutate production v2 GLBs', () => {
    const before = sha256File('public/assets/models/v2/torpedo.glb');
    const result = runImport(['--manifest', productionManifest, '--dry-run']);
    expect(result.status).not.toBe(0);
    const after = sha256File('public/assets/models/v2/torpedo.glb');
    expect(after).toBe(before);
  });

  it('fixture validate leaves production v2 bytes unchanged', () => {
    const tracked = [
      'public/assets/models/v2/sub_nautilus.glb',
      'public/assets/models/v2/torpedo.glb',
      'public/assets/models/v2/destroyer.glb',
    ];
    const before = new Map(tracked.map((path) => [path, sha256File(path)]));
    const result = runImport(['--manifest', fixtureManifest, '--validate']);
    expect(result.status).toBe(0);
    for (const path of tracked) {
      expect(sha256File(path)).toBe(before.get(path));
    }
  });
});
