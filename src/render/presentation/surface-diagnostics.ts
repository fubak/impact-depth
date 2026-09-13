export type SurfaceAttitudeSource = 'probe' | 'fallback';

export interface SurfaceDiagnostics {
  readonly surfaceHeight: number | null;
  readonly hullDraft: number;
  readonly requestedX: number;
  readonly requestedZ: number;
  readonly resolvedX: number;
  readonly resolvedZ: number;
  readonly source: SurfaceAttitudeSource;
  readonly missionGeneration: number;
  readonly backendGeneration: number;
  readonly probeAge: number;
  readonly readbackCount: number;
  readonly cadenceHz: number;
}

/** Look-dev only. Never shown on the player HUD. */
export function formatSurfaceDiagnostics(diag: SurfaceDiagnostics): string {
  const height = diag.surfaceHeight === null ? '—' : diag.surfaceHeight.toFixed(2);
  const age = Number.isFinite(diag.probeAge) ? `${diag.probeAge.toFixed(2)}s` : '—';
  return [
    `surf ${height}m`,
    `draft ${diag.hullDraft.toFixed(2)}m`,
    `req ${diag.requestedX.toFixed(1)},${diag.requestedZ.toFixed(1)}`,
    `got ${diag.resolvedX.toFixed(1)},${diag.resolvedZ.toFixed(1)}`,
    diag.source,
    `gen ${diag.missionGeneration}/${diag.backendGeneration}`,
    age,
    `${diag.readbackCount} rb`,
    `${diag.cadenceHz} Hz`,
  ].join(' · ');
}
