/** Three.js cache residuals allowed after backend/quality teardown cycles. */
export const RESOURCE_CYCLE_SLACK_MULTIPLIER = 3;
export const RESOURCE_CYCLE_SLACK_ABS = 32;

export type ResourceCounts = {
  geometries: number;
  textures: number;
  programs: number;
};

export function extractResourceCounts(probe: unknown): ResourceCounts {
  const graphics =
    probe && typeof probe === 'object' && 'graphics' in probe
      ? (probe as { graphics?: { memory?: { geometries?: number; textures?: number }; programs?: number } })
          .graphics
      : undefined;
  const memory = graphics?.memory ?? {};
  return {
    geometries: Number(memory.geometries ?? 0),
    textures: Number(memory.textures ?? 0),
    programs: Number(graphics?.programs ?? 0),
  };
}

export function resourceCycleSlackLimit(baseline: number): number {
  return baseline * RESOURCE_CYCLE_SLACK_MULTIPLIER + RESOURCE_CYCLE_SLACK_ABS;
}

export function checkResourceCycleSlack(
  baseline: ResourceCounts,
  current: ResourceCounts,
  label: string,
): string[] {
  const failures: string[] = [];
  for (const key of ['geometries', 'textures', 'programs'] as const) {
    const limit = resourceCycleSlackLimit(baseline[key]);
    if (current[key] > limit) {
      failures.push(
        `${label}: ${key}=${current[key]} exceeds slack limit ${limit} (warmup baseline ${baseline[key]})`,
      );
    }
  }
  return failures;
}

export function checkResourceCycleMonotonicGrowth(
  samples: readonly ResourceCounts[],
  label: string,
): string[] {
  const failures: string[] = [];
  if (samples.length < 3) return failures;
  for (const key of ['geometries', 'textures', 'programs'] as const) {
    let strictIncreases = 0;
    for (let i = 1; i < samples.length; i++) {
      if (samples[i]![key] > samples[i - 1]![key]) strictIncreases += 1;
    }
    if (strictIncreases === samples.length - 1) {
      failures.push(
        `${label}: ${key} strictly increased every cycle (${samples[0]![key]} → ${samples.at(-1)?.[key]})`,
      );
    }
  }
  return failures;
}
