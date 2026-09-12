/**
 * Normalize licensed source meshes into game-oriented local space and write
 * public/assets/models/v2/*.glb plus a machine-readable import report.
 *
 * Plan 015 / 018 constraints:
 * - Never downloads, never reads cookies, never invents licenses.
 * - Inputs come only from config/fleet-source-manifest.json staged under artifacts/fleet-sources/.
 * - Outputs land under models/v2 (immutable path for this content set).
 * - Validate or dry-run before any output mutation.
 *
 * Usage:
 *   node scripts/import-modern-fleet.mjs [--validate] [--dry-run] [--manifest <path>]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import {
  parseImportFlags,
  validateFleetSourceManifest,
} from './lib/fleet-source-manifest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const flags = parseImportFlags(process.argv.slice(2));

const validation = validateFleetSourceManifest(flags.manifestPath, root);
if (!validation.ok) {
  console.error('Fleet source manifest validation failed:');
  for (const err of validation.errors) console.error(`  ${err}`);
  process.exit(1);
}

const { manifest, stagingRoot, outputDir } = validation;
const reportDir = resolve(root, manifest.reportDir ?? 'artifacts/fleet-sources');

if (flags.validate) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: flags.dryRun ? 'dry-run' : 'validate',
        manifest: flags.manifestPath,
        entities: validation.entities.length,
        stagingRoot,
        outputDir,
      },
      null,
      2,
    ),
  );
  if (flags.dryRun) {
    for (const entity of validation.entities) {
      console.log(`would import ${entity.kind} ← ${entity.inputRel} → models/v2/${entity.kind}.glb`);
    }
  }
  process.exit(0);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function mulMat4(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function translation(x, y, z) {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

function scaleMat(s) {
  return new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]);
}

function rotationY(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

function identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function sizeOf(bounds) {
  return {
    x: bounds.max[0] - bounds.min[0],
    y: bounds.max[1] - bounds.min[1],
    z: bounds.max[2] - bounds.min[2],
  };
}

function ensureRootWrapper(document) {
  const scene = document.getRoot().listScenes()[0];
  if (!scene) throw new Error('no scene');
  const children = scene.listChildren();
  if (children.length === 1) return children[0];
  const wrap = document.createNode('vessel_root');
  for (const child of [...children]) {
    scene.removeChild(child);
    wrap.addChild(child);
  }
  scene.addChild(wrap);
  return wrap;
}

function applyWorldMatrix(node, matrix) {
  const current = node.getMatrix()?.length === 16 ? Float32Array.from(node.getMatrix()) : identity();
  node.setMatrix(Array.from(mulMat4(matrix, current)));
}

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

async function normalizeFile(inputPath, targetLength) {
  const document = await io.read(inputPath);
  const scene = document.getRoot().listScenes()[0];
  if (!scene) throw new Error(`no scene in ${inputPath}`);
  const rootNode = ensureRootWrapper(document);

  let bounds = getBounds(scene);
  let size = sizeOf(bounds);
  // Longest horizontal → +X (game bow convention).
  if (size.z >= size.x) {
    applyWorldMatrix(rootNode, rotationY(-Math.PI / 2));
    bounds = getBounds(scene);
    size = sizeOf(bounds);
  }

  const length = Math.max(size.x, size.z);
  const s = targetLength / Math.max(length, 1e-4);
  applyWorldMatrix(rootNode, scaleMat(s));
  bounds = getBounds(scene);

  const midX = (bounds.min[0] + bounds.max[0]) * 0.5;
  const midZ = (bounds.min[2] + bounds.max[2]) * 0.5;
  applyWorldMatrix(rootNode, translation(-midX, -bounds.min[1], -midZ));
  bounds = getBounds(scene);
  size = sizeOf(bounds);

  return {
    document,
    stats: {
      size,
      min: bounds.min,
      max: bounds.max,
      tris: countTris(document),
    },
  };
}

mkdirSync(outputDir, { recursive: true });
mkdirSync(reportDir, { recursive: true });

const report = [];
const creditsById = new Map();
const failures = [];

for (const [kind, entry] of Object.entries(manifest.entities)) {
  creditsById.set(entry.licenseId, {
    id: entry.licenseId,
    source: entry.source,
    license: entry.license,
    usage: entry.usage,
  });

  const input = resolve(stagingRoot, entry.input);
  const outName = `${kind}.glb`;
  console.log('normalize', input, '→', outName, '@', entry.targetLengthM, 'm');
  try {
    const { document, stats } = await normalizeFile(input, entry.targetLengthM);
    const dest = resolve(outputDir, outName);
    await io.write(dest, document);
    const bytes = readFileSync(dest).byteLength;
    console.log(
      ' wrote',
      outName,
      `${(bytes / 1024).toFixed(1)}KB`,
      `len=${stats.size.x.toFixed(2)}`,
      `beam=${stats.size.z.toFixed(2)}`,
      `tris≈${stats.tris}`,
      `y=${stats.min[1].toFixed(2)}..${stats.max[1].toFixed(2)}`,
    );
    report.push({
      kind,
      file: `models/v2/${outName}`,
      bytes,
      input: entry.input,
      resolvedInput: input,
      credit: entry.licenseId,
      ...stats,
    });
  } catch (err) {
    failures.push({ kind, reason: String(err) });
    console.error('FAIL', kind, err);
  }
}

writeFileSync(
  resolve(reportDir, 'import-report-v2.json'),
  JSON.stringify({ credits: [...creditsById.values()], report, failures }, null, 2),
);
writeFileSync(resolve(reportDir, 'credits-v2.json'), JSON.stringify([...creditsById.values()], null, 2));

if (failures.length) {
  console.error(`import finished with ${failures.length} failure(s)`);
  process.exitCode = 1;
} else {
  console.log(`done — ${report.length} entities written to models/v2`);
}
