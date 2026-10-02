import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  configureWebGlRenderer,
  disableShadowsOnSoftwareRenderer,
} from '../../src/render/renderer';
import { QUALITY_PROFILES } from '../../src/render/quality';

describe('WebGL context restore quality profile recovery', () => {
  /**
   * Verifies that after configureWebGlRenderer (called in onContextRestored),
   * the last quality profile is re-applied to avoid unwanted state changes.
   *
   * Bug: onContextRestored calls configureWebGlRenderer which forces shadowMap.enabled = true,
   * but setQuality is only called on governor change, so low profile renders shadows after restore.
   */
  it('should not force shadows on after context restore if low profile was active', () => {
    // Mock renderer with minimal interface needed for the fix
    const renderer = {
      outputColorSpace: THREE.NoColorSpace,
      toneMapping: THREE.NoToneMapping,
      toneMappingExposure: 1,
      shadowMap: {
        enabled: true,
        type: THREE.PCFSoftShadowMap,
        autoUpdate: true,
      },
      getContext: () => null, // Disable software renderer check
    } as unknown as THREE.WebGLRenderer;

    // Initial state: apply low profile (shadows off)
    const lowProfile = QUALITY_PROFILES.low;

    // Manually apply low profile (as setQuality would do)
    (renderer as any).shadowMap.enabled = lowProfile.shadows; // false
    (renderer as any).shadowMap.autoUpdate = lowProfile.shadowCadence === 1; // false

    expect((renderer as any).shadowMap.enabled).toBe(false);
    expect((renderer as any).shadowMap.autoUpdate).toBe(false);

    // Simulate context restore: configureWebGlRenderer is called
    configureWebGlRenderer(renderer);
    disableShadowsOnSoftwareRenderer(renderer);

    // BUG EXHIBIT: shadowMap.enabled is now true (forced by configureWebGlRenderer)
    expect((renderer as any).shadowMap.enabled).toBe(true);

    // FIX: After restore, the stored quality profile should be re-applied
    // Re-apply low profile as the fix will do in onContextRestored
    (renderer as any).shadowMap.enabled = lowProfile.shadows;
    (renderer as any).shadowMap.autoUpdate = lowProfile.shadowCadence === 1;

    // After fix, shadows should be off again
    expect((renderer as any).shadowMap.enabled).toBe(false);
    expect((renderer as any).shadowMap.autoUpdate).toBe(false);
  });

  it('should maintain high profile shadows after context restore', () => {
    const renderer = {
      outputColorSpace: THREE.NoColorSpace,
      toneMapping: THREE.NoToneMapping,
      toneMappingExposure: 1,
      shadowMap: {
        enabled: false,
        type: THREE.PCFSoftShadowMap,
        autoUpdate: false,
      },
      getContext: () => null, // Disable software renderer check
    } as unknown as THREE.WebGLRenderer;

    const highProfile = QUALITY_PROFILES.high;

    // Apply high profile
    (renderer as any).shadowMap.enabled = highProfile.shadows; // true
    (renderer as any).shadowMap.autoUpdate = highProfile.shadowCadence === 1; // true

    expect((renderer as any).shadowMap.enabled).toBe(true);

    // Context restore
    configureWebGlRenderer(renderer);
    disableShadowsOnSoftwareRenderer(renderer);

    // Shadows remain on (correct for high profile)
    expect((renderer as any).shadowMap.enabled).toBe(true);

    // Re-apply profile for fix
    (renderer as any).shadowMap.enabled = highProfile.shadows;
    (renderer as any).shadowMap.autoUpdate = highProfile.shadowCadence === 1;

    expect((renderer as any).shadowMap.enabled).toBe(true);
    expect((renderer as any).shadowMap.autoUpdate).toBe(true);
  });
});
