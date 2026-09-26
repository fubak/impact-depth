export const CINEMA_FOLLOW_MS = 3500;
export const CINEMA_LINGER_MS = 1000;

export interface CinemaPoint {
  x: number;
  y: number;
  z: number;
  heading: number;
}

export interface CinemaTrack {
  id: string | null;
  until: number;
  last: CinemaPoint | null;
  lingerUntil: number;
}

export interface CinemaStep {
  track: CinemaTrack;
  cinema?: CinemaPoint;
  snapToTarget?: boolean;
}

export const idleTrack = (): CinemaTrack => ({ id: null, until: 0, last: null, lingerUntil: 0 });

export const startTrack = (id: string, now: number): CinemaTrack => ({
  id,
  until: now + CINEMA_FOLLOW_MS,
  last: null,
  lingerUntil: 0,
});

const release = (): CinemaStep => ({ track: idleTrack(), snapToTarget: true });

/**
 * Follows a fired torpedo until it hits or times out, then lingers on the last point so the
 * impact is framed. An escort gaining contact on the boat always cancels the shot camera.
 */
export function stepTrack(
  track: CinemaTrack,
  fish: CinemaPoint | undefined,
  escortFix: boolean,
  now: number,
): CinemaStep {
  const active = track.id !== null || track.lingerUntil > 0;
  if (!active) return { track };
  if (escortFix) return release();
  if (track.id !== null) {
    if (now > track.until) return release();
    if (fish) return { track: { ...track, last: fish }, cinema: fish };
    if (!track.last) return release();
    return {
      track: { id: null, until: 0, last: track.last, lingerUntil: now + CINEMA_LINGER_MS },
      cinema: track.last,
    };
  }
  if (now >= track.lingerUntil || !track.last) return release();
  return { track, cinema: track.last };
}
