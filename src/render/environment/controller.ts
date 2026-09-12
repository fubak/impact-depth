import type {
  BackendFactory,
  EnvironmentBackend,
  EnvironmentDiagnostics,
  EnvironmentFrame,
  EnvironmentQuality,
  OceanBackendName,
  WorldVersion,
} from './types';

export class EnvironmentController {
  private backend: EnvironmentBackend | null;
  private initGeneration = 0;
  private missionGeneration = 0;
  private requestedBackend: OceanBackendName;
  private fallbackReason: string | null = null;
  private disposed = false;
  private readonly factory: BackendFactory;
  private worldVersion: WorldVersion;

  constructor(opts: {
    backend: EnvironmentBackend;
    factory: BackendFactory;
    requestedBackend?: OceanBackendName;
    worldVersion?: WorldVersion;
  }) {
    this.backend = opts.backend;
    this.factory = opts.factory;
    this.requestedBackend = opts.requestedBackend ?? opts.backend.name;
    this.worldVersion = opts.worldVersion ?? 'legacy-v1';
  }

  get current(): EnvironmentBackend | null {
    return this.backend;
  }

  prepare(frame: EnvironmentFrame): void {
    this.backend?.prepare(frame);
  }

  renderPasses(): void {
    this.backend?.renderPasses();
  }

  resize(width: number, height: number, dpr: number): void {
    this.backend?.resize(width, height, dpr);
  }

  setQuality(profile: EnvironmentQuality): void {
    this.backend?.setQuality(profile);
  }

  reset(missionGeneration: number): void {
    this.missionGeneration = missionGeneration;
    this.backend?.reset(missionGeneration);
  }

  getDiagnostics(): EnvironmentDiagnostics {
    const inner = this.backend?.getDiagnostics();
    return {
      backend: inner?.backend ?? 'gerstner',
      requestedBackend: this.requestedBackend,
      ready: Boolean(this.backend) && !this.disposed && (inner?.ready ?? true),
      fallbackReason: this.fallbackReason,
      missionGeneration: this.missionGeneration,
      worldVersion: inner?.worldVersion ?? this.worldVersion,
    };
  }

  async activate(name: OceanBackendName, signal: AbortSignal): Promise<void> {
    if (this.disposed) throw new Error('environment disposed');
    this.requestedBackend = name;
    if (this.backend?.name === name) {
      this.fallbackReason = null;
      return;
    }
    const token = ++this.initGeneration;
    let created: EnvironmentBackend | null = null;
    try {
      created = await this.factory(name, signal);
      if (signal.aborted || token !== this.initGeneration || this.disposed) {
        created.dispose();
        created = null;
        this.fallbackReason = 'init cancelled';
        return;
      }
      this.swap(created);
      created = null;
      this.fallbackReason = name === this.backend?.name ? null : this.fallbackReason;
    } catch (error) {
      created?.dispose();
      const reason = error instanceof Error ? error.message : String(error);
      this.fallbackReason = reason;
      if (name !== 'gerstner' && this.backend?.name !== 'gerstner') {
        const gerstner = await this.factory('gerstner', signal);
        if (signal.aborted || token !== this.initGeneration || this.disposed) {
          gerstner.dispose();
          return;
        }
        this.swap(gerstner);
      }
    }
  }

  dispose(): void {
    this.initGeneration += 1;
    this.disposed = true;
    this.backend?.dispose();
    this.backend = null;
  }

  private swap(next: EnvironmentBackend): void {
    const previous = this.backend;
    this.backend = next;
    next.reset(this.missionGeneration);
    if (previous && previous !== next) previous.dispose();
  }
}
