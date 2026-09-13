import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(__dirname, '../public/assets/models/v1');

// GLTFExporter uses FileReader to serialize embedded binary data. Node provides
// Blob, but not FileReader in every supported release.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    result = null;
    error = null;
    onloadend = null;

    async readAsArrayBuffer(blob) {
      try {
        this.result = await blob.arrayBuffer();
      } catch (error) {
        this.error = error;
      }
      this.onloadend?.();
    }

    async readAsDataURL(blob) {
      try {
        const bytes = Buffer.from(await blob.arrayBuffer()).toString('base64');
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${bytes}`;
      } catch (error) {
        this.error = error;
      }
      this.onloadend?.();
    }
  };
}

const THREE = await import('three');
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');

// Brightened vs. v1 so MeshStandardMaterial reads correctly under water-fogged
// daylight IBL instead of crushing toward black. AssetRegistry.normalize()
// clamps metalness <= 0.22 and roughness >= 0.4 at load time, so keep authored
// values inside that band to avoid a runtime shift in appearance.
const palette = {
  hull: 0x4c666b,
  hullLight: 0x5f7c82,
  deck: 0x334850,
  superstructure: 0x86969a,
  brass: 0xd8a760,
  cargo: 0x7f5936,
  concrete: 0xaba17f,
  funnel: 0x584c40,
  glass: 0x9fd0dc,
  warning: 0xb5442f,
};

function material(color, roughness = 0.6, metalness = 0.14) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function mesh(geometry, color, name, roughness, metalness) {
  const part = new THREE.Mesh(geometry, material(color, roughness, metalness));
  part.name = name;
  part.castShadow = true;
  return part;
}

/**
 * Waterline-silhouette hull: a sharper bow point and finer stern tuck than a
 * plain hexagon reads as a ship in the quarter/oblique views used most in
 * gameplay. Extruded vertically and re-oriented so the shape's beam axis
 * becomes world Z (bow stays +X, deck sits at +Y).
 */
function hull(length, beam, height, color = palette.hull) {
  const half = length / 2;
  const shape = new THREE.Shape()
    .moveTo(-half, 0)
    .lineTo(-half * 0.88, beam * 0.22)
    .lineTo(-half * 0.45, beam * 0.48)
    .lineTo(half * 0.05, beam * 0.5)
    .lineTo(half * 0.42, beam * 0.42)
    .lineTo(half * 0.72, beam * 0.22)
    .lineTo(half * 0.92, beam * 0.08)
    .lineTo(half, 0)
    .lineTo(half * 0.92, -beam * 0.08)
    .lineTo(half * 0.72, -beam * 0.22)
    .lineTo(half * 0.42, -beam * 0.42)
    .lineTo(half * 0.05, -beam * 0.5)
    .lineTo(-half * 0.45, -beam * 0.48)
    .lineTo(-half * 0.88, -beam * 0.22)
    .lineTo(-half, 0);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: Math.min(beam * 0.06, height * 0.15),
    bevelThickness: height * 0.12,
    curveSegments: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, height / 2, 0);
  return mesh(geometry, color, 'hull', 0.6, 0.16);
}

function addBox(group, name, dimensions, position, color, roughness, metalness, rotation) {
  const part = mesh(new THREE.BoxGeometry(...dimensions), color, name, roughness, metalness);
  part.position.set(...position);
  if (rotation) part.rotation.set(...rotation);
  group.add(part);
  return part;
}

function addCylinder(
  group,
  name,
  radiusTop,
  radiusBottom,
  height,
  radialSegments,
  position,
  color,
  roughness,
  metalness,
  rotation,
) {
  const part = mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments),
    color,
    name,
    roughness,
    metalness,
  );
  part.position.set(...position);
  if (rotation) part.rotation.set(...rotation);
  group.add(part);
  return part;
}

function addRails(group, length, beam, deckY, color = palette.deck) {
  for (const side of [1, -1]) {
    addBox(
      group,
      'rail',
      [length * 0.72, 0.1, 0.05],
      [-length * 0.04, deckY + 0.55, side * beam * 0.47],
      color,
      0.5,
      0.2,
    );
  }
}

function addMast(group, x, baseY, height, color = palette.superstructure) {
  addCylinder(group, 'mast', 0.06, 0.09, height, 6, [x, baseY + height / 2, 0], color, 0.42, 0.4);
  addBox(group, 'yardarm', [0.9, 0.07, 0.07], [x, baseY + height * 0.68, 0], color, 0.42, 0.4);
  addBox(
    group,
    'radar_dish',
    [0.55, 0.5, 0.08],
    [x - 0.1, baseY + height * 0.92, 0],
    palette.concrete,
    0.5,
    0.2,
  );
}

function addFunnel(group, x, deckY, height, radiusTop, radiusBottom) {
  addCylinder(
    group,
    'funnel',
    radiusTop,
    radiusBottom,
    height,
    10,
    [x, deckY + height / 2, 0],
    palette.funnel,
    0.55,
    0.22,
  );
  addCylinder(
    group,
    'funnel_cap',
    radiusTop * 1.12,
    radiusTop * 1.12,
    0.18,
    10,
    [x, deckY + height + 0.09, 0],
    palette.deck,
    0.5,
    0.2,
  );
}

function addTurret(group, x, deckY, { twin = false, barrelLength = 2.8, barbette = true } = {}) {
  if (barbette) {
    addCylinder(
      group,
      'barbette',
      0.62,
      0.78,
      0.35,
      10,
      [x, deckY + 0.18, 0],
      palette.hullLight,
      0.55,
      0.2,
    );
  }
  addCylinder(
    group,
    'gun_turret',
    0.55,
    0.72,
    0.5,
    10,
    [x, deckY + 0.62, 0],
    palette.superstructure,
    0.5,
    0.2,
  );
  const zOffsets = twin ? [-0.32, 0.32] : [0];
  for (const z of zOffsets) {
    const barrel = mesh(
      new THREE.CylinderGeometry(0.09, 0.11, barrelLength, 8),
      palette.deck,
      'gun_barrel',
      0.48,
      0.25,
    );
    barrel.rotation.z = Math.PI / 2;
    barrel.position.set(x + barrelLength / 2 + 0.35, deckY + 0.7, z);
    group.add(barrel);
  }
}

function addVent(group, x, z, deckY, color = palette.deck) {
  addCylinder(group, 'ventilator', 0.22, 0.28, 0.6, 8, [x, deckY + 0.3, z], color, 0.6, 0.15);
}

function createSurfaceShip(kind, config) {
  const group = new THREE.Group();
  group.name = kind;
  const deckY = config.height + 0.05;
  group.add(hull(config.length, config.beam, config.height, config.hullColor));

  addBox(
    group,
    'deck',
    [config.length * 0.82, 0.26, config.beam * 0.74],
    [-config.length * 0.02, deckY, 0],
    palette.deck,
  );

  // Raised forecastle wedge near the bow, capped by a low breakwater.
  addBox(
    group,
    'forecastle',
    [config.length * 0.18, config.height * 0.32, config.beam * 0.6],
    [config.length * 0.33, deckY + config.height * 0.16, 0],
    palette.hullLight,
    0.55,
  );
  addBox(
    group,
    'breakwater',
    [0.3, 0.55, config.beam * 0.5],
    [config.length * 0.41, deckY + config.height * 0.32 + 0.25, 0],
    palette.deck,
  );

  addBox(
    group,
    'bridge',
    [config.bridgeLength, config.bridgeHeight, config.beam * 0.54],
    [config.bridgeX, deckY + config.bridgeHeight / 2, 0],
    config.bridgeColor ?? palette.superstructure,
  );
  addBox(
    group,
    'bridge_wheelhouse',
    [config.bridgeLength * 0.55, config.bridgeHeight * 0.42, config.beam * 0.4],
    [config.bridgeX + config.bridgeLength * 0.06, deckY + config.bridgeHeight * 1.2, 0],
    palette.deck,
  );
  for (const wing of [1, -1]) {
    addBox(
      group,
      'bridge_wing',
      [config.bridgeLength * 0.14, 0.14, config.beam * 0.14],
      [
        config.bridgeX - config.bridgeLength * 0.35,
        deckY + config.bridgeHeight * 0.7,
        wing * config.beam * 0.3,
      ],
      palette.deck,
    );
  }

  addMast(
    group,
    config.bridgeX - config.bridgeLength * 0.45,
    deckY + config.bridgeHeight,
    config.mastHeight ?? 6,
  );

  if (config.radarDome) {
    const dome = mesh(
      new THREE.SphereGeometry(Math.max(0.35, config.beam * 0.14), 12, 10),
      0xe8ece6,
      'radar_dome',
      0.4,
      0.2,
    );
    dome.position.set(config.bridgeX, deckY + config.bridgeHeight * 1.35 + 0.35, 0);
    group.add(dome);
  }

  for (const cargoX of config.cargo ?? []) {
    addBox(
      group,
      'cargo_hold',
      [config.length * 0.16, 1.6, config.beam * 0.62],
      [cargoX, deckY + 0.95, 0],
      palette.cargo,
    );
    addBox(
      group,
      'hatch_coaming',
      [config.length * 0.12, 0.22, config.beam * 0.44],
      [cargoX, deckY + 1.85, 0],
      palette.deck,
    );
    if (config.kingPosts) {
      addCylinder(
        group,
        'king_post',
        0.09,
        0.12,
        3.2,
        6,
        [cargoX - config.length * 0.05, deckY + 1.6, 0],
        palette.superstructure,
        0.5,
        0.2,
      );
      addBox(
        group,
        'cargo_boom',
        [config.length * 0.12, 0.1, 0.1],
        [cargoX + config.length * 0.02, deckY + 3.0, 0.4],
        palette.superstructure,
        0.5,
        0.2,
        [0, 0, -0.35],
      );
    }
  }

  for (const funnelConfig of config.funnels ?? []) {
    addFunnel(group, funnelConfig.x, deckY, funnelConfig.height, funnelConfig.rt, funnelConfig.rb);
  }

  for (const turretConfig of config.turrets ?? []) {
    addTurret(group, turretConfig.x, deckY, turretConfig);
  }

  addRails(group, config.length, config.beam, config.height);

  for (const vent of config.vents ?? []) {
    addVent(group, vent[0], vent[1] ?? 0, deckY);
  }

  if (config.lifeRafts) {
    for (const side of [1, -1]) {
      addCylinder(
        group,
        'life_raft',
        0.42,
        0.42,
        0.3,
        8,
        [config.bridgeX - config.bridgeLength * 0.8, deckY + 0.4, side * config.beam * 0.42],
        palette.warning,
        0.6,
        0.1,
        [0, 0, Math.PI / 2],
      );
    }
  }

  group.scale.setScalar(config.scale);
  return group;
}

function createSubmarine(kind, scale = 1, options = {}) {
  const group = new THREE.Group();
  group.name = kind;
  const body = mesh(
    new THREE.CapsuleGeometry(0.92, 12.4, 8, 18),
    palette.hull,
    'pressure_hull',
    0.55,
    0.18,
  );
  body.rotation.z = Math.PI / 2;
  body.scale.set(1, 0.86, 1);
  group.add(body);

  const bow = mesh(
    new THREE.SphereGeometry(0.95, 14, 10),
    palette.hullLight,
    'sonar_dome',
    0.5,
    0.16,
  );
  bow.scale.set(1.35, 0.78, 0.9);
  bow.position.set(7.1, -0.05, 0);
  group.add(bow);

  addBox(group, 'deck_casing', [11.5, 0.35, 1.55], [0.2, 0.78, 0], palette.deck);
  addBox(group, 'sail', [2.8, 2.85, 1.05], [-0.55, 2.0, 0], palette.superstructure);
  addBox(group, 'sail_cap', [2.1, 0.32, 0.9], [-0.45, 3.5, 0], palette.deck);
  addBox(group, 'sail_bridge', [1.1, 0.55, 0.95], [0.35, 2.55, 0], palette.deck);
  for (const [dx, h, color] of [
    [0.55, 3.1, palette.brass],
    [0.15, 2.7, palette.superstructure],
    [-0.35, 2.4, palette.deck],
  ]) {
    addCylinder(group, 'mast', 0.055, 0.065, h, 6, [dx, 3.55 + h * 0.25, 0.08], color, 0.35, 0.5);
  }
  addBox(group, 'bow_planes', [0.9, 0.08, 2.8], [4.2, 0.2, 0], palette.hull);
  addBox(group, 'stern_planes', [0.8, 0.08, 2.4], [-6.2, 0.15, 0], palette.hull);
  addBox(group, 'rudder', [0.18, 1.9, 0.08], [-6.65, 0.55, 0], palette.hull);
  for (const z of [-0.35, 0.35]) {
    const propeller = mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.32, 8),
      palette.brass,
      'propeller',
      0.3,
      0.55,
    );
    propeller.rotation.z = Math.PI / 2;
    propeller.position.set(-7.05, -0.05, z);
    group.add(propeller);
  }

  // Fleet boat / U-boat deck gun silhouette.
  addCylinder(group, 'barbette', 0.28, 0.34, 0.35, 8, [2.6, 1.15, 0], palette.hullLight, 0.5, 0.2);
  {
    const barrel = mesh(
      new THREE.CylinderGeometry(0.07, 0.09, 1.8, 8),
      palette.deck,
      'gun_barrel',
      0.45,
      0.25,
    );
    barrel.rotation.z = Math.PI / 2;
    barrel.position.set(3.45, 1.35, 0);
    group.add(barrel);
  }
  if (options.conningExtra) {
    addBox(group, 'conning_extension', [3.3, 1.2, 1.4], [-0.7, 3.55, 0], palette.deck);
  }

  group.scale.setScalar(scale);
  return group;
}

function createAircraft() {
  const group = new THREE.Group();
  group.name = 'aircraft';
  const fuselage = mesh(
    new THREE.CapsuleGeometry(0.42, 5.4, 6, 12),
    0x4a6458,
    'fuselage',
    0.48,
    0.28,
  );
  fuselage.rotation.z = Math.PI / 2;
  group.add(fuselage);
  const nose = mesh(new THREE.ConeGeometry(0.4, 1.1, 10), 0x2a3430, 'nose_cone', 0.4, 0.35);
  nose.rotation.z = -Math.PI / 2;
  nose.position.x = 3.4;
  group.add(nose);
  addBox(group, 'cockpit', [1.0, 0.42, 0.55], [1.1, 0.45, 0], palette.glass, 0.22, 0.05);
  addBox(group, 'main_wing', [1.5, 0.14, 9.2], [0.2, 0.05, 0], 0x5a7264, 0.5, 0.2);
  for (const side of [1, -1]) {
    const eng = mesh(
      new THREE.CapsuleGeometry(0.28, 1.4, 4, 8),
      0x323a38,
      'engine_nacelle',
      0.5,
      0.45,
    );
    eng.rotation.z = Math.PI / 2;
    eng.position.set(0.15, -0.2, side * 2.4);
    group.add(eng);
  }
  addBox(group, 'tailplane', [1.4, 0.12, 3.1], [-2.5, 0.35, 0], 0x5a7264, 0.5, 0.2);
  addBox(group, 'tailfin', [0.9, 1.35, 0.12], [-2.55, 0.85, 0], 0x5a7264, 0.5, 0.2);
  return group;
}

function createFob() {
  const group = new THREE.Group();
  group.name = 'fob_argus';
  const platform = mesh(
    new THREE.CylinderGeometry(9.2, 10.5, 1.35, 28),
    0x8a8060,
    'platform',
    0.88,
    0.08,
  );
  platform.position.y = 0.55;
  group.add(platform);

  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const leg = mesh(
      new THREE.CylinderGeometry(0.45, 0.55, 3.2, 8),
      0x3a4040,
      'support_leg',
      0.6,
      0.4,
    );
    leg.position.set(Math.cos(angle) * 6.8, -0.9, Math.sin(angle) * 6.8);
    group.add(leg);
  }

  const tower = mesh(
    new THREE.CylinderGeometry(2.5, 3.6, 8.2, 14),
    0xd8d4c4,
    'command_tower',
    0.62,
    0.12,
  );
  tower.position.y = 5.0;
  group.add(tower);
  addBox(group, 'tower_house', [4.2, 1.4, 4.2], [0, 9.4, 0], palette.deck, 0.55, 0.15);

  addBox(group, 'crane_post', [0.55, 4.2, 0.55], [5.2, 2.8, 4.8], 0x4a5048, 0.5, 0.2);
  addBox(
    group,
    'crane_boom',
    [5.5, 0.28, 0.28],
    [7.6, 4.8, 4.8],
    0x5a6058,
    0.5,
    0.2,
    [0, 0, -0.28],
  );

  addCylinder(group, 'antenna_mast', 0.1, 0.14, 5.5, 6, [0.4, 12.2, 0], 0x3a4040, 0.45, 0.55);
  addBox(group, 'radar_array', [1.8, 1.1, 0.2], [0.5, 13.4, 0], 0xc8c4b0, 0.5, 0.2);
  addBox(group, 'ladder', [0.35, 7.2, 0.1], [-2.6, 4.5, 3.2], palette.deck, 0.6, 0.15);

  const beacon = mesh(new THREE.SphereGeometry(0.5, 12, 10), 0xff4939, 'beacon', 0.35, 0.05);
  beacon.position.y = 15.0;
  group.add(beacon);
  return group;
}

function createTorpedo() {
  const group = new THREE.Group();
  group.name = 'torpedo';
  const body = mesh(new THREE.CapsuleGeometry(0.16, 1.25, 4, 8), palette.deck, 'body', 0.5, 0.3);
  body.rotation.z = Math.PI / 2;
  group.add(body);
  const nose = mesh(new THREE.ConeGeometry(0.16, 0.3, 8), palette.warning, 'warhead_tip', 0.4, 0.3);
  nose.rotation.z = -Math.PI / 2;
  nose.position.x = 0.95;
  group.add(nose);
  const band = mesh(
    new THREE.CylinderGeometry(0.165, 0.165, 0.06, 8),
    palette.brass,
    'band',
    0.4,
    0.5,
  );
  band.rotation.z = Math.PI / 2;
  band.position.x = 0.55;
  group.add(band);
  for (const angle of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
    const fin = mesh(new THREE.BoxGeometry(0.28, 0.32, 0.03), palette.brass, 'tail_fin', 0.38, 0.5);
    fin.position.set(-0.82, Math.cos(angle) * 0.2, Math.sin(angle) * 0.2);
    fin.rotation.x = angle;
    group.add(fin);
  }
  return group;
}

function createCrate() {
  const group = new THREE.Group();
  group.name = 'crate';
  addBox(group, 'crate_body', [1.4, 1, 1.1], [0, 0, 0], palette.cargo, 0.85, 0.03);
  addBox(group, 'strap_h', [1.46, 1.05, 0.12], [0, 0, 0], palette.deck);
  addBox(group, 'strap_v', [0.12, 1.05, 1.16], [0, 0, 0], palette.deck);
  for (const x of [-0.6, 0.6]) {
    addBox(group, 'corner_bracket', [0.14, 1.02, 0.14], [x, 0, 0.46], palette.brass, 0.4, 0.4);
    addBox(group, 'corner_bracket', [0.14, 1.02, 0.14], [x, 0, -0.46], palette.brass, 0.4, 0.4);
  }
  return group;
}

const fleet = {
  // Base capsule is ~12.1m; 0.9 matches the sub_nautilus scale in vessels.ts
  // so the hero submarine reads at its intended ~10.9m gameplay length.
  sub_nautilus: () => createSubmarine('sub_nautilus', 0.9),
  destroyer: () =>
    createSurfaceShip('destroyer', {
      length: 30,
      beam: 4.4,
      height: 2.5,
      bridgeLength: 4.2,
      bridgeHeight: 2.8,
      bridgeX: 2.2,
      mastHeight: 7.5,
      funnels: [
        { x: -2.8, height: 3.2, rt: 0.5, rb: 0.7 },
        { x: -5.5, height: 2.6, rt: 0.42, rb: 0.58 },
      ],
      turrets: [
        { x: 9.2, twin: false },
        { x: -9.5, twin: false },
      ],
      vents: [
        [4.5, 1.2],
        [4.5, -1.2],
      ],
      lifeRafts: true,
      scale: 0.58,
    }),
  freighter: () =>
    createSurfaceShip('freighter', {
      length: 38,
      beam: 6.8,
      height: 3.4,
      bridgeLength: 5.2,
      bridgeHeight: 4.2,
      bridgeX: -13.5,
      mastHeight: 8,
      funnels: [{ x: -13.5, height: 4.2, rt: 0.85, rb: 1.05 }],
      cargo: [9, 0.5, -8],
      kingPosts: true,
      lifeRafts: true,
      scale: 0.52,
    }),
  patrol: () =>
    createSurfaceShip('patrol', {
      length: 18,
      beam: 3.1,
      height: 1.7,
      bridgeLength: 4.8,
      bridgeHeight: 1.8,
      bridgeX: -1,
      mastHeight: 4.5,
      hullColor: 0x5f7c82,
      bridgeColor: 0xe0ded0,
      turrets: [{ x: 5.8, twin: false, barbette: false }],
      radarDome: true,
      scale: 0.62,
    }),
  cruiser: () =>
    createSurfaceShip('cruiser', {
      length: 34,
      beam: 5.2,
      height: 2.8,
      bridgeLength: 6.5,
      bridgeHeight: 3.2,
      bridgeX: 3.5,
      mastHeight: 9,
      hullColor: 0x2c3a3e,
      funnels: [
        { x: -1.5, height: 3.6, rt: 0.55, rb: 0.75 },
        { x: -4.2, height: 3.6, rt: 0.55, rb: 0.75 },
      ],
      turrets: [
        { x: 8.5, twin: false, barrelLength: 4.2 },
        { x: -6.5, twin: false, barrelLength: 4.2 },
        { x: -12, twin: false, barrelLength: 4.2 },
      ],
      vents: [
        [4.5, 1.4],
        [4.5, -1.4],
        [-2, 1.7],
        [-2, -1.7],
      ],
      lifeRafts: true,
      scale: 0.55,
    }),
  battleship: () =>
    createSurfaceShip('battleship', {
      length: 42,
      beam: 6.4,
      height: 3.4,
      bridgeLength: 8.5,
      bridgeHeight: 4.0,
      bridgeX: 2.0,
      mastHeight: 11,
      hullColor: 0x243034,
      funnels: [
        { x: -2, height: 4.4, rt: 0.7, rb: 0.95 },
        { x: -5.5, height: 4.4, rt: 0.7, rb: 0.95 },
      ],
      turrets: [
        { x: 11, twin: true, barrelLength: 5.8 },
        { x: 4, twin: true, barrelLength: 5.8 },
        { x: -8, twin: true, barrelLength: 5.8 },
        { x: -14, twin: true, barrelLength: 5.8 },
      ],
      vents: [
        [5, 1.8],
        [5, -1.8],
        [-2.5, 2.0],
        [-2.5, -2.0],
      ],
      lifeRafts: true,
      scale: 0.48,
    }),
  // vessels.ts derives the U-boat from the 0.9-scaled submarine and then
  // multiplies by 1.48 (=> 1.332 absolute); pass the resolved absolute scale
  // here since this script builds each hull independently.
  uboat: () => createSubmarine('uboat', 1.332, { deckGun: true, conningExtra: true }),
  aircraft: createAircraft,
  fob_argus: createFob,
  torpedo: createTorpedo,
  crate: createCrate,
};

/** Keep CC-BY Sketchfab hero combat meshes; bake only project-owned class silhouettes. */
const PRESERVE_EXTERNAL = new Set(['sub_nautilus', 'destroyer', 'uboat']);

const triBudgets = {
  sub_nautilus: 12000,
  destroyer: 8000,
  freighter: 6000,
  patrol: 8000,
  cruiser: 12000,
  battleship: 12000,
  uboat: 12000,
  aircraft: 2000,
  fob_argus: 2000,
  torpedo: 2000,
  crate: 2000,
};

function countTriangles(scene) {
  let triangles = 0;
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry;
    const count = geometry.index ? geometry.index.count : geometry.attributes.position.count;
    triangles += count / 3;
  });
  return triangles;
}

async function exportFleet() {
  await mkdir(outputDirectory, { recursive: true });
  const exporter = new GLTFExporter();
  const entries = Object.entries(fleet).filter(([kind]) => !PRESERVE_EXTERNAL.has(kind));
  console.log(
    `exporting ${entries.length} procedural entities (preserving external: ${[...PRESERVE_EXTERNAL].join(', ')})`,
  );
  await Promise.all(
    entries.map(async ([kind, create]) => {
      const scene = create();
      scene.updateMatrixWorld(true);
      const triangles = countTriangles(scene);
      const budget = triBudgets[kind] ?? 12000;
      if (triangles > budget) {
        console.warn(`${kind}: ${triangles} tris exceeds budget of ${budget}`);
      }
      const glb = await exporter.parseAsync(scene, { binary: true, onlyVisible: true });
      await writeFile(resolve(outputDirectory, `${kind}.glb`), Buffer.from(glb));
      console.log(`exported ${kind}.glb (${triangles} tris)`);
    }),
  );
}

await exportFleet();
