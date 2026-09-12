/**
 * Shared fleet source manifest validation for import-modern-fleet.mjs and tests.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const defaultManifestPath = resolve(__dirname, '../../config/fleet-source-manifest.json');

const REQUIRED_ENTITY_FIELDS = ['input', 'targetLengthM', 'licenseId', 'source', 'license', 'usage'];
/** Entity keys become `${kind}.glb` under outputDir — no path separators or traversal. */
export const SAFE_ENTITY_KIND = /^[A-Za-z0-9_-]+$/;

/**
 * True when `child` resolves inside `parent` (or equals it).
 * @param {string} parent
 * @param {string} child
 */
export function isPathInside(parent, child) {
  const absParent = resolve(parent);
  const absChild = resolve(child);
  const rel = relative(absParent, absChild);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * @param {string} [manifestPath]
 * @param {string} [repoRoot]
 */
export function loadManifest(manifestPath = defaultManifestPath, repoRoot = resolve(__dirname, '../..')) {
  if (!existsSync(manifestPath)) {
    throw new Error(`fleet source manifest missing at ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return { manifest, repoRoot, manifestPath };
}

/**
 * Resolve a manifest entity input to an absolute staged file path.
 * @param {Record<string, unknown>} manifest
 * @param {string} repoRoot
 * @param {string} inputRel
 */
export function resolveStagedInput(manifest, repoRoot, inputRel) {
  const stagingRoot = resolve(repoRoot, manifest.stagingRoot ?? 'artifacts/fleet-sources');
  return resolve(stagingRoot, inputRel);
}

/**
 * Validate manifest schema and that every staged source file exists.
 * Never treats production outputs as acceptable import inputs.
 *
 * @param {string} [manifestPath]
 * @param {string} [repoRoot]
 */
export function validateFleetSourceManifest(manifestPath = defaultManifestPath, repoRoot = resolve(__dirname, '../..')) {
  const errors = [];
  const entities = [];

  let manifest;
  try {
    ({ manifest } = loadManifest(manifestPath, repoRoot));
  } catch (err) {
    return { ok: false, errors: [String(err)], entities: [], manifest: null, manifestPath };
  }

  if (!manifest.entities || typeof manifest.entities !== 'object') {
    errors.push('manifest.entities must be an object');
    return { ok: false, errors, entities, manifest, manifestPath };
  }

  const stagingRoot = resolve(repoRoot, manifest.stagingRoot ?? 'artifacts/fleet-sources');
  const outputDir = resolve(repoRoot, manifest.outputDir ?? 'public/assets/models/v2');

  for (const [kind, entry] of Object.entries(manifest.entities)) {
    if (!entry || typeof entry !== 'object') {
      errors.push(`${kind}: entity entry must be an object`);
      continue;
    }

    if (!SAFE_ENTITY_KIND.test(kind)) {
      errors.push(
        `${kind}: entity key must match ${SAFE_ENTITY_KIND} (becomes ${kind}.glb under outputDir)`,
      );
      continue;
    }

    for (const field of REQUIRED_ENTITY_FIELDS) {
      if (entry[field] === undefined || entry[field] === null || entry[field] === '') {
        errors.push(`${kind}: missing required field "${field}"`);
      }
    }

    if (typeof entry.targetLengthM !== 'number' || !(entry.targetLengthM > 0)) {
      errors.push(`${kind}: targetLengthM must be a positive number`);
    }

    const inputRel = String(entry.input ?? '');
    const stagedPath = resolve(stagingRoot, inputRel);
    const productionPath = resolve(outputDir, `${kind}.glb`);

    if (!inputRel) continue;

    if (!isPathInside(stagingRoot, stagedPath)) {
      errors.push(
        `${kind}: manifest input escapes staging root ${relativeFromRoot(repoRoot, stagingRoot)} (manifest input: ${inputRel})`,
      );
      continue;
    }

    if (resolve(stagedPath) === resolve(productionPath)) {
      errors.push(
        `${kind}: manifest input must not reference production output ${manifest.outputDir ?? 'public/assets/models/v2'}/${kind}.glb`,
      );
    }

    if (!existsSync(stagedPath)) {
      errors.push(
        `${kind}: missing staged source at ${relativeFromRoot(repoRoot, stagedPath)} (manifest input: ${inputRel})`,
      );
    }

    entities.push({
      kind,
      inputRel,
      stagedPath,
      targetLengthM: entry.targetLengthM,
      licenseId: entry.licenseId,
      exists: existsSync(stagedPath),
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    entities,
    manifest,
    manifestPath,
    stagingRoot,
    outputDir,
  };
}

/**
 * @param {string} root
 * @param {string} abs
 */
function relativeFromRoot(root, abs) {
  const rel = abs.startsWith(root) ? abs.slice(root.length + 1) : abs;
  return rel.replace(/\\/g, '/');
}

/**
 * @param {string[]} argv
 */
export function parseImportFlags(argv) {
  const flags = { validate: false, dryRun: false, manifestPath: defaultManifestPath };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--validate') flags.validate = true;
    else if (arg === '--dry-run') {
      flags.validate = true;
      flags.dryRun = true;
    } else if (arg === '--manifest' && argv[i + 1]) {
      flags.manifestPath = resolve(argv[++i]);
    }
  }
  return flags;
}
