/** Shared look-dev types — no Three.js dependency. */

/** View selection is presentation-only; it never changes simulation aiming. */
export type ViewMode = 'tactical' | 'chase' | 'bridge' | 'periscope' | 'free' | 'map' | 'sonar';

export type EngineOrder = 'stop' | 'slow' | 'half' | 'full' | 'flank';

export interface WaveComponent {
  amplitude: number;
  wavelength: number;
  direction: number;
  steepness: number;
  phase: number;
}

export interface WaveSample {
  height: number;
  dx: number;
  dz: number;
  normalX: number;
  normalY: number;
  normalZ: number;
}

export interface AtmosphereSettings {
  timeOfDay: number;
  fogDensity: number;
  exposure: number;
  sunElevation: number;
  sunAzimuth: number;
  sunIntensity: number;
}

export interface OceanSettings {
  seaState: number;
  waveHeight: number;
  choppiness: number;
  deepColor: string;
  shallowColor: string;
  foamAmount: number;
  /** 0 = murky/opaque … 1 = crystal clear overhead */
  clarity: number;
  /** 0 = pale … 1 = strong depth absorption tint */
  absorption: number;
}

export interface EnvironmentSettings {
  sandColor: string;
  foliageColor: string;
  rockColor: string;
}

export interface PresentationSettings {
  hudOpacity: number;
  labelDensity: number;
  filmGrain: number;
  vignette: number;
  tacticalGrid: boolean;
}

export interface LookDevSettings {
  atmosphere: AtmosphereSettings;
  ocean: OceanSettings;
  environment: EnvironmentSettings;
  presentation: PresentationSettings;
  preset: string;
}

export type PresetId = 'caribbean-noon' | 'trade-wind-morning' | 'golden-cay';

export interface VesselState {
  x: number;
  z: number;
  /** Depth in meters; 0 = surface, positive = deeper */
  depth: number;
  heading: number;
  speed: number;
  targetSpeed: number;
  engineOrder: EngineOrder;
  battery: number;
  noise: number;
  heave: number;
  pitch: number;
  roll: number;
}

export interface SurfaceShipState {
  id: string;
  kind: 'patrol' | 'destroyer' | 'merchant' | 'cruiser' | 'battleship' | 'uboat';
  name: string;
  x: number;
  z: number;
  /** Depth in meters; enemy subs sit below the sheet. */
  depth: number;
  heading: number;
  speed: number;
  heave: number;
  pitch: number;
  roll: number;
  /** 0 while afloat; 0..1 as the hull goes down. */
  sinkProgress: number;
  sinkStyle?: 'bow' | 'stern' | 'list' | 'break';
  listSide: number;
  fire: number;
  flooding: number;
}

export interface SimState {
  paused: boolean;
  time: number;
  viewMode: ViewMode;
  vessel: VesselState;
  ships: SurfaceShipState[];
  mission: string;
}
