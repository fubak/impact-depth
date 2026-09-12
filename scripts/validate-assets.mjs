/**
 * Validate production asset pipeline: every manifest entity resolves a file,
 * has provenance, and stays under triangle budgets (unless waived).
 *
 * Usage: node scripts/validate-assets.mjs
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const manifestPath = resolve(root, 'public/assets/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const budgets = {
  sub_nautilus: manifest.budgets?.heroVesselTris ?? 12000,
  destroyer: manifest.budgets?.escortTris ?? 8000,
  patrol: manifest.budgets?.escortTris ?? 8000,
  cruiser: manifest.budgets?.heroVesselTris ?? 12000,
  battleship: manifest.budgets?.heroVesselTris ?? 12000,
  freighter: manifest.budgets?.merchantTris ?? 6000,
  uboat: manifest.budgets?.heroVesselTris ?? 12000,
  aircraft: manifest.budgets?.propTris ?? 2000,
  fob_argus: (manifest.budgets?.propTris ?? 2000) * 4,
  torpedo: manifest.budgets?.propTris ?? 2000,
  crate: manifest.budgets?.propTris ?? 2000,
};

const licenses = new Map((manifest.licenseLedger ?? []).map((e) => [e.id, e]));
const errors = [];
const warnings = [];
const report = [];

function countTris(document) {
  let tris = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      if (indices) tris += indices.getCount() / 3;
      else {
        const pos = prim.getAttribute('POSITION');
        if (pos) tris += pos.getCount() / 3;
      }
    }
  }
  return Math.round(tris);
}

for (const [kind, entry] of Object.entries(manifest.entities ?? {})) {
  const gltfRel = entry.gltf;
  if (!gltfRel) {
    errors.push(`${kind}: missing gltf path`);
    continue;
  }
  const abs = resolve(root, 'public/assets', gltfRel);
  if (!existsSync(abs)) {
    errors.push(`${kind}: file missing at ${gltfRel}`);
    continue;
  }
  if (!entry.licenseId || !licenses.has(entry.licenseId)) {
    errors.push(`${kind}: missing or unknown licenseId (${entry.licenseId ?? 'none'})`);
  }
  const bytes = statSync(abs).size;
  let tris = null;
  try {
    const doc = await io.read(abs);
    tris = countTris(doc);
    const budget = budgets[kind] ?? 12000;
    if (tris > budget * 1.15) {
      warnings.push(`${kind}: ${tris} tris exceeds budget ${budget} (+15% grace)`);
    }
  } catch (err) {
    errors.push(`${kind}: invalid glb (${err})`);
  }
  report.push({ kind, gltf: gltfRel, bytes, tris, licenseId: entry.licenseId });
}

console.log(JSON.stringify({ ok: errors.length === 0, report, warnings, errors }, null, 2));
if (errors.length) process.exit(1);
