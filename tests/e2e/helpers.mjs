/** Shared constants and helpers for browser smoke / FPS probes. */

export const DEFAULT_URL = 'http://127.0.0.1:8080/';
export const VIEWPORT = { width: 1440, height: 900 };
export const SMOKE_TIMEOUT_MS = Number(process.env.BROWSER_SMOKE_TIMEOUT_MS || 45000);

/** Chromium launch args suitable for headless CI containers. */
export const CHROMIUM_ARGS = ['--no-sandbox', '--disable-dev-shm-usage'];

export const MODE_LABEL = {
  tactical: 'TACTICAL',
  periscope: 'PERISCOPE',
  sonar: 'SONAR PLOT',
};

/**
 * Median of a numeric sample (sorted copy).
 * @param {number[]} values
 */
export function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Approximate percentile (nearest-rank).
 * @param {number[]} values
 * @param {number} p 0–100
 */
export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
