import * as THREE from 'three';
import {
  biomeColorWeights,
  ISLAND_MESH_RADIUS_FACTOR,
  sampleIslandHeight,
  type IslandSpec,
  ISLAND_SPECS,
} from '../core/terrain';
import type { EnvironmentSettings } from '../core/types';
import { SHORE_WET_BAND_METRES } from './environment/terrain-texture';
import {
  VegetationField,
  type VegetationQuality,
} from './environment/vegetation';

function tintIslandVertex(
  h: number,
  sand: THREE.Color,
  grass: THREE.Color,
  rock: THREE.Color,
  shelf: THREE.Color,
  out: THREE.Color,
): void {
  const w = biomeColorWeights(h);
  out.setRGB(
    shelf.r * w.shelf + sand.r * w.beach + grass.r * w.grass + rock.r * w.rock,
    shelf.g * w.shelf + sand.g * w.beach + grass.g * w.grass + rock.g * w.rock,
    shelf.b * w.shelf + sand.b * w.beach + grass.b * w.grass + rock.b * w.rock,
  );
}

/** Island terrain with height-driven roughness and a narrow wet-sand shoreline band. */
function createIslandTerrainMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.03,
    flatShading: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWetBand = { value: SHORE_WET_BAND_METRES * 0.14 };
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>\nvarying float vIslandHeight;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\nvIslandHeight = transformed.y;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\nvarying float vIslandHeight;\nuniform float uWetBand;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
       float wet = 1.0 - smoothstep(0.05, uWetBand, vIslandHeight);
       roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.42, wet * 0.85);
       diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.78, 0.82, 0.86), wet * 0.35);`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
       float grain = sin(vIslandHeight * 3.7 + vNormal.x * 18.0) * 0.5 + 0.5;
       normal = normalize(normal + vec3(grain * 0.04, 0.0, grain * 0.03));`,
    );
  };
  material.customProgramCacheKey = () => 'island-terrain-wet-band';
  material.shadowSide = THREE.FrontSide;
  return material;
}

/**
 * Radial disc terrain — natural circular silhouette, no square apron edges.
 * Rings × sectors; outer ring locks to seabed height.
 */
function buildIslandGeometry(spec: IslandSpec, rings = 44, sectors = 64): THREE.BufferGeometry {
  const maxR = spec.radius * ISLAND_MESH_RADIUS_FACTOR;
  const sand = new THREE.Color(0xc8b57a);
  const grass = new THREE.Color(0x3d8f52);
  const rock = new THREE.Color(0x7a8a72);
  const shelf = new THREE.Color(0x9aaa88);
  const tmp = new THREE.Color();

  const vertCount = 1 + rings * sectors;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const indices: number[] = [];

  const h0 = sampleIslandHeight(0, 0, spec);
  positions[0] = 0;
  positions[1] = h0;
  positions[2] = 0;
  tintIslandVertex(h0, sand, grass, rock, shelf, tmp);
  colors[0] = tmp.r;
  colors[1] = tmp.g;
  colors[2] = tmp.b;

  for (let ring = 1; ring <= rings; ring++) {
    const t = ring / rings;
    const rt = t * t * (3 - 2 * t);
    const radius = maxR * rt;
    for (let s = 0; s < sectors; s++) {
      const ang = (s / sectors) * Math.PI * 2;
      const wobble = 1 + 0.04 * Math.sin(ang * 3 + spec.seed) + 0.025 * Math.cos(ang * 5 - spec.seed);
      const lx = Math.cos(ang) * radius * wobble;
      const lz = Math.sin(ang) * radius * wobble;
      const h = sampleIslandHeight(lx, lz, spec);
      const i = 1 + (ring - 1) * sectors + s;
      positions[i * 3] = lx;
      positions[i * 3 + 1] = h;
      positions[i * 3 + 2] = lz;
      tintIslandVertex(h, sand, grass, rock, shelf, tmp);
      const rimFade = Math.max(0, (rt - 0.88) / 0.12);
      if (rimFade > 0) {
        tmp.lerp(new THREE.Color(0x7ab0a0), rimFade * 0.35);
      }
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
  }

  for (let s = 0; s < sectors; s++) {
    const a = 1 + s;
    const b = 1 + ((s + 1) % sectors);
    indices.push(0, b, a);
  }
  for (let ring = 1; ring < rings; ring++) {
    const row = 1 + (ring - 1) * sectors;
    const next = 1 + ring * sectors;
    for (let s = 0; s < sectors; s++) {
      const s2 = (s + 1) % sectors;
      const a = row + s;
      const b = row + s2;
      const c = next + s;
      const d = next + s2;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export class IslandField {
  readonly group = new THREE.Group();
  private readonly terrains: THREE.Mesh[] = [];
  private readonly foamMeshes: THREE.Mesh[] = [];
  private readonly vegetation: VegetationField;
  private lastEnvKey = '';
  private windDirection = 0.85;
  private windStrength = 0.45;

  constructor(specs: readonly IslandSpec[] = ISLAND_SPECS) {
    const terrainMaterial = createIslandTerrainMaterial();

    for (const spec of specs) {
      const geo = buildIslandGeometry(spec);
      const mesh = new THREE.Mesh(geo, terrainMaterial.clone());
      mesh.position.set(spec.cx, 0, spec.cz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.renderOrder = 0;
      this.terrains.push(mesh);
      this.group.add(mesh);

      const foam = new THREE.Mesh(
        new THREE.RingGeometry(spec.radius * 0.78, spec.radius * 1.03, 64),
        new THREE.MeshBasicMaterial({
          color: 0xeaf9ef,
          transparent: true,
          opacity: 0.26,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      foam.rotation.x = -Math.PI / 2;
      foam.position.set(spec.cx, 0.12, spec.cz);
      foam.renderOrder = 3;
      this.foamMeshes.push(foam);
      this.group.add(foam);
    }

    this.vegetation = new VegetationField(specs);
    this.group.add(this.vegetation.group);
  }

  setQuality(profile: VegetationQuality): void {
    this.vegetation.setQuality(profile);
  }

  applyEnvironment(env: EnvironmentSettings): void {
    const key = `${env.sandColor}|${env.foliageColor}|${env.rockColor}`;
    if (key === this.lastEnvKey) return;
    this.lastEnvKey = key;

    const sand = new THREE.Color(env.sandColor);
    const grass = new THREE.Color(env.foliageColor);
    const rock = new THREE.Color(env.rockColor);
    const shelf = sand.clone().lerp(new THREE.Color(0x8a7a52), 0.35);
    const tmp = new THREE.Color();

    for (const mesh of this.terrains) {
      const geo = mesh.geometry;
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const col = geo.attributes.color as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        tintIslandVertex(pos.getY(i), sand, grass, rock, shelf, tmp);
        col.setXYZ(i, tmp.r, tmp.g, tmp.b);
      }
      col.needsUpdate = true;
    }

    this.vegetation.setColor(env.foliageColor);
  }

  updatePresentation(
    time: number,
    windDetail: number,
    cameraPosition: THREE.Vector3,
    paused: boolean,
    reducedMotion: boolean,
  ): void {
    this.windDirection = 0.85 + Math.sin(time * 0.04) * 0.35;
    this.windStrength = reducedMotion ? windDetail * 0.18 : 0.28 + windDetail * 0.55;
    this.vegetation.update(
      time,
      this.windDirection,
      this.windStrength,
      cameraPosition,
      paused,
    );
  }

  dispose(): void {
    for (const mesh of this.terrains) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    for (const foam of this.foamMeshes) {
      foam.geometry.dispose();
      (foam.material as THREE.Material).dispose();
    }
    this.vegetation.dispose();
  }
}
