import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import type { LookDevSettings } from '../../src/core/types';
import { adaptToLookDevSim } from '../../src/game/adapt/lookdev';
import { createGame } from '../../src/game/sim/create';
import { configureSurfaceMaterial } from '../../src/render/assets';
import {
  PLAYER_HULL_CAUSTIC_SCALE,
  UNDERWATER_ALBEDO_FLOOR,
  UNDERWATER_KEY_EMISSIVE,
  UNDERWATER_KEY_INTENSITY,
  applyHullPresentation,
  captureMaterialBaseline,
  ensureUniqueStandardMaterials,
  patchPlayerHullFragment,
  restoreMaterialBaseline,
} from '../../src/render/presentation/hull-materials';
import { GameScene } from '../../src/render/scene';

function standard(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x4a5560,
    metalness: 0.12,
    roughness: 0.55,
    emissive: 0x000000,
    emissiveIntensity: 0,
    envMapIntensity: 0.7,
  });
}

describe('hull material baselines', () => {
  it('restores exact authored values after a deep-to-surface roundtrip', () => {
    const material = standard();
    captureMaterialBaseline(material);
    applyHullPresentation(material, { peri: false, depthMetres: 18 });
    expect(material.emissiveIntensity).toBeLessThan(0.15);
    applyHullPresentation(material, { peri: false, depthMetres: 0 });
    restoreMaterialBaseline(material);
    expect(material.emissive.getHex()).toBe(0);
    expect(material.emissiveIntensity).toBe(0);
    expect(material.metalness).toBeCloseTo(0.12);
    expect(material.roughness).toBeCloseTo(0.55);
    expect(material.opacity).toBe(1);
    expect(material.transparent).toBe(false);
  });

  it('does not leak presentation edits across two hulls that started from one material', () => {
    const shared = standard();
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared);
    const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared);
    ensureUniqueStandardMaterials(a);
    ensureUniqueStandardMaterials(b);
    expect(a.material).not.toBe(b.material);
    applyHullPresentation(a.material as THREE.MeshStandardMaterial, {
      peri: true,
      depthMetres: 7,
    });
    expect((b.material as THREE.MeshStandardMaterial).opacity).toBe(1);
    expect((b.material as THREE.MeshStandardMaterial).transparent).toBe(false);
  });

  it('bumps material.version only when periscope transparency actually flips', () => {
    const material = standard();
    const step = (peri: boolean): number => {
      const before = material.version;
      applyHullPresentation(material, { peri, depthMetres: 3 });
      return material.version - before;
    };
    expect(step(false)).toBe(0);
    expect(step(true)).toBe(1);
    expect(step(true)).toBe(0);
    expect(step(false)).toBe(1);
    expect(step(false)).toBe(0);
    expect(step(true)).toBe(1);
  });

  it('does not bake cyan self-light into imported hulls', () => {
    const material = standard();
    configureSurfaceMaterial(material);
    expect(material.emissiveIntensity).toBeLessThan(0.05);
    expect(material.emissive.getHex()).toBe(0);
  });

  it('clamps station lighting after restore without cyan emissive', () => {
    const material = new THREE.MeshStandardMaterial({
      color: 0x4a5560,
      metalness: 0.9,
      roughness: 0.2,
      emissive: 0x000000,
      emissiveIntensity: 0,
      envMapIntensity: 1,
    });
    captureMaterialBaseline(material);
    applyHullPresentation(material, { peri: false, depthMetres: 0 });
    expect(material.metalness).toBeLessThanOrEqual(0.18);
    expect(material.roughness).toBeGreaterThanOrEqual(0.5);
    expect(material.envMapIntensity).toBeCloseTo(0.85);
    expect(material.emissive.getHex()).toBe(0);
    expect(material.emissiveIntensity).toBe(0);
  });

  it('applies depth fade on top of the 0.85 envMapIntensity scale', () => {
    const material = standard();
    captureMaterialBaseline(material);
    applyHullPresentation(material, { peri: false, depthMetres: 14 });
    const depthFade = 1 - Math.min(0.45, 14 / 28);
    expect(material.envMapIntensity).toBeCloseTo(0.7 * depthFade * 0.85);
  });

  it('lifts only the underwater player hull, then restores the authored baseline', () => {
    const material = new THREE.MeshStandardMaterial({
      color: 0x101418,
      metalness: 0.52,
      roughness: 0.48,
      emissive: 0x163848,
      emissiveIntensity: 0.42,
      envMapIntensity: 0.7,
    });
    captureMaterialBaseline(material);
    const fog = new THREE.Color(0x051a21);
    const luma = (color: THREE.Color): number =>
      0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
    const beforeRatio = luma(material.color) / luma(fog);
    expect(beforeRatio).toBeLessThan(1.4);

    applyHullPresentation(material, { peri: false, depthMetres: 18 });
    expect(material.color.getHex()).toBe(0x101418);
    expect(material.emissive.getHex()).toBe(0x163848);
    expect(material.emissiveIntensity).toBeCloseTo(0.42);

    applyHullPresentation(material, { peri: false, depthMetres: 18, underwaterSubject: true });
    expect(material.color.r).toBeGreaterThanOrEqual(UNDERWATER_ALBEDO_FLOOR);
    expect(material.color.g).toBeGreaterThanOrEqual(UNDERWATER_ALBEDO_FLOOR);
    expect(material.color.b).toBeGreaterThanOrEqual(UNDERWATER_ALBEDO_FLOOR);
    expect(luma(material.color) / luma(fog)).toBeGreaterThanOrEqual(1.4);
    expect(material.emissive.getHex()).toBe(UNDERWATER_KEY_EMISSIVE);
    expect(material.emissive.getHex()).not.toBe(0x163848);
    expect(material.emissiveIntensity).toBe(UNDERWATER_KEY_INTENSITY);
    expect(material.emissiveIntensity).toBeLessThan(0.15);

    const shader = {
      uniforms: {},
      vertexShader: '',
      fragmentShader: [
        '#include <lights_fragment_end>',
        'reflectedLight.directDiffuse += sampleProjectedCaustics(vCausticWorld);',
        '#include <fog_fragment>',
      ].join('\n'),
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('smoothstep(30.0, 38.0, vFogDepth)');
    expect(shader.fragmentShader).toContain('silentRim');
    expect(shader.fragmentShader).toContain(
      `sampleProjectedCaustics(vCausticWorld) * ${PLAYER_HULL_CAUSTIC_SCALE.toFixed(2)}`,
    );
    expect(shader.fragmentShader).toContain('silentDepthsPreFog');
    const version = material.version;
    applyHullPresentation(material, { peri: false, depthMetres: 18, underwaterSubject: true });
    expect(material.version).toBe(version);

    applyHullPresentation(material, { peri: false, depthMetres: 0 });
    expect(material.color.getHex()).toBe(0x101418);
    expect(material.emissive.getHex()).toBe(0x163848);
    expect(material.emissiveIntensity).toBeCloseTo(0.42);
    expect(material.metalness).toBeLessThanOrEqual(0.18);
    expect(material.opacity).toBe(1);
    expect(material.transparent).toBe(false);
    expect(material.userData.silentDepthsPlayerHullLight).toBeUndefined();
    const surfaced = {
      uniforms: {},
      vertexShader: '',
      fragmentShader: '#include <fog_fragment>\n',
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(surfaced, {} as THREE.WebGLRenderer);
    expect(surfaced.fragmentShader).not.toContain('silentExempt');
    expect(patchPlayerHullFragment('#include <fog_fragment>\n')).toContain('smoothstep(30.0, 38.0');
  });
});

/** Seabed's TextureLoader needs document.createElementNS; node has neither. */
function installDomStub(): void {
  if (typeof document !== 'undefined') return;
  const gradient = { addColorStop: () => undefined };
  const ctx = {
    clearRect: () => undefined,
    fillRect: () => undefined,
    fillText: () => undefined,
    createRadialGradient: () => gradient,
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
  };
  const canvas = () => ({ width: 64, height: 64, getContext: () => ctx });
  const img = () => ({
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    src: '',
  });
  Object.assign(globalThis, {
    document: {
      createElement: (tag: string) => (tag === 'canvas' ? canvas() : img()),
      createElementNS: () => img(),
    },
  });
}

describe('player hull underwater subject on the scene', () => {
  beforeAll(installDomStub);

  it('restores authored baselines after the chase camera surfaces', () => {
    const view = new GameScene();
    try {
      const material = new THREE.MeshStandardMaterial({
        color: 0x101418,
        emissive: 0x163848,
        emissiveIntensity: 0.42,
        metalness: 0.4,
        roughness: 0.5,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
      view.sub.userData.assetSource = 'gltf';
      view.sub.add(mesh);

      const game = createGame(1);
      game.ships = [];
      game.submarine.z = 0.75;
      game.viewMode = 'chase';
      const settings: LookDevSettings = {
        ...DEFAULT_SETTINGS,
        presentation: { ...DEFAULT_SETTINGS.presentation, labelDensity: 0 },
      };
      view.syncGame(game, adaptToLookDevSim(game), settings, 1 / 60);
      const live = mesh.material as THREE.MeshStandardMaterial;
      expect(live.color.getHex()).toBe(0x101418);

      const camera = new THREE.PerspectiveCamera();
      camera.position.y = -8;
      view.applyImmersion(camera);
      expect(live.color.r).toBeGreaterThanOrEqual(UNDERWATER_ALBEDO_FLOOR);
      expect(live.emissive.getHex()).toBe(UNDERWATER_KEY_EMISSIVE);
      expect(live.emissiveIntensity).toBeLessThan(0.15);

      camera.position.y = 12;
      view.applyImmersion(camera);
      expect(live.color.getHex()).toBe(0x101418);
      expect(live.emissive.getHex()).toBe(0x163848);
      expect(live.emissiveIntensity).toBeCloseTo(0.42);

      game.viewMode = 'periscope';
      view.syncGame(game, adaptToLookDevSim(game), settings, 1 / 60);
      camera.position.y = -8;
      view.applyImmersion(camera);
      const peri = mesh.material as THREE.MeshStandardMaterial;
      expect(peri.color.getHex()).toBe(0x101418);
      expect(peri.emissive.getHex()).toBe(0x163848);
    } finally {
      view.dispose();
    }
  });
});
