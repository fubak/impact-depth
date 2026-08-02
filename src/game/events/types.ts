export type GameEvent =
  | { type: 'message'; text: string }
  | { type: 'sonarPulse'; x: number; y: number }
  | { type: 'explosion'; x: number; y: number; z: number };
