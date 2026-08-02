import * as THREE from 'three';

const HULL = 0x243032;
const HULL_LIGHT = 0x3a484a;
const BRASS = 0xbd8b4e;
const DECK = 0x1a2224;
const SUPER = 0x2a3234;
const FUNNEL = 0x3a322c;
const hullAlbedo = new THREE.TextureLoader().load('/assets/textures/hull-metal-albedo.png');
hullAlbedo.colorSpace = THREE.SRGBColorSpace;
hullAlbedo.wrapS = THREE.RepeatWrapping;
hullAlbedo.wrapT = THREE.RepeatWrapping;
hullAlbedo.repeat.set(2, 1);

function mat(
  color: number,
  opts: { metalness?: number; roughness?: number; flat?: boolean } = {},
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color,
    metalness: opts.metalness ?? 0.42,
    roughness: opts.roughness ?? 0.55,
    flatShading: opts.flat ?? false,
  });
  if (opts.metalness && opts.metalness > 0.3) material.map = hullAlbedo;
  return material;
}

/** Waterline silhouette extruded into a tapered hull (X = length, bow +X). */
function createTaperedHull(
  length: number,
  beam: number,
  height: number,
  color: number,
): THREE.Mesh {
  const half = length * 0.5;
  const shape = new THREE.Shape();
  // Sharper bow point, finer stern tuck — reads as a ship in quarter view
  shape.moveTo(-half, 0);
  shape.lineTo(-half * 0.88, beam * 0.22);
  shape.lineTo(-half * 0.45, beam * 0.48);
  shape.lineTo(half * 0.05, beam * 0.5);
  shape.lineTo(half * 0.42, beam * 0.42);
  shape.lineTo(half * 0.72, beam * 0.22);
  shape.lineTo(half * 0.92, beam * 0.08);
  shape.lineTo(half, 0);
  shape.lineTo(half * 0.92, -beam * 0.08);
  shape.lineTo(half * 0.72, -beam * 0.22);
  shape.lineTo(half * 0.42, -beam * 0.42);
  shape.lineTo(half * 0.05, -beam * 0.5);
  shape.lineTo(-half * 0.45, -beam * 0.48);
  shape.lineTo(-half * 0.88, -beam * 0.22);
  shape.lineTo(-half, 0);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: true,
    bevelThickness: height * 0.12,
    bevelSize: Math.min(beam * 0.06, height * 0.15),
    bevelSegments: 2,
    curveSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, height * 0.5, 0);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, mat(color, { roughness: 0.58, metalness: 0.38 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addDeckHouse(
  parent: THREE.Group,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  color = SUPER,
): THREE.Mesh {
  const house = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    mat(color, { roughness: 0.5, metalness: 0.45 }),
  );
  house.position.set(x, y, z);
  house.castShadow = true;
  parent.add(house);
  return house;
}

export function createSubmarine(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'submarine';

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.95, 10.2, 6, 14),
    mat(0x121c20, { roughness: 0.5, metalness: 0.45 }),
  );
  body.rotation.z = Math.PI / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // Slight underlight so the hull reads through clear water
  const fill = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.72, 8.6, 4, 10),
    new THREE.MeshStandardMaterial({
      color: 0x2a4550,
      roughness: 0.72,
      metalness: 0.15,
      emissive: 0x1a3848,
      emissiveIntensity: 0.55,
    }),
  );
  fill.rotation.z = Math.PI / 2;
  g.add(fill);

  const bow = new THREE.Mesh(
    new THREE.ConeGeometry(0.95, 2.6, 12),
    mat(HULL_LIGHT, { roughness: 0.48 }),
  );
  bow.rotation.z = -Math.PI / 2;
  bow.position.x = 6.5;
  bow.castShadow = true;
  g.add(bow);

  const sail = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 2.6, 1.15),
    mat(SUPER, { metalness: 0.55, roughness: 0.45 }),
  );
  sail.position.set(-0.4, 1.75, 0);
  sail.castShadow = true;
  g.add(sail);

  const sailFair = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.35, 0.95),
    mat(DECK, { metalness: 0.5 }),
  );
  sailFair.position.set(-0.35, 3.15, 0);
  g.add(sailFair);

  const peri = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6),
    mat(BRASS, { metalness: 0.75, roughness: 0.32 }),
  );
  peri.position.set(0.35, 4.35, 0.12);
  g.add(peri);

  const divePlane = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 2.4), mat(HULL_LIGHT));
  divePlane.position.set(3.8, 0.15, 0);
  g.add(divePlane);

  const sternPlane = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.7, 0.1), mat(HULL_LIGHT));
  sternPlane.position.set(-5.9, 0.35, 0);
  g.add(sternPlane);

  const prop = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 0.35, 8),
    mat(BRASS, { metalness: 0.85, roughness: 0.3 }),
  );
  prop.rotation.z = Math.PI / 2;
  prop.position.set(-6.55, 0, 0);
  g.add(prop);

  g.scale.setScalar(0.9);
  return g;
}

export function createDestroyer(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'destroyer';

  g.add(createTaperedHull(30, 4.4, 2.5, HULL));

  const sheer = new THREE.Mesh(
    new THREE.BoxGeometry(22, 0.28, 3.4),
    mat(DECK, { metalness: 0.5, roughness: 0.48 }),
  );
  sheer.position.set(-0.8, 2.55, 0);
  sheer.castShadow = true;
  g.add(sheer);

  // Flared bow deck wedge
  const forecastle = new THREE.Mesh(
    new THREE.BoxGeometry(5.5, 0.9, 3.0),
    mat(HULL_LIGHT, { metalness: 0.45 }),
  );
  forecastle.position.set(10.2, 2.85, 0);
  forecastle.scale.set(1, 1, 0.85);
  forecastle.castShadow = true;
  g.add(forecastle);

  addDeckHouse(g, 2.2, 4.1, 0, 4.2, 2.8, 3.0);
  addDeckHouse(g, 2.2, 5.7, 0, 2.6, 0.9, 2.2, DECK);

  const funnel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.75, 3.2, 10),
    mat(FUNNEL, { metalness: 0.4, roughness: 0.55 }),
  );
  funnel.position.set(-2.8, 5.0, 0);
  funnel.castShadow = true;
  g.add(funnel);

  const funnel2 = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.6, 2.6, 10),
    mat(FUNNEL, { metalness: 0.4, roughness: 0.55 }),
  );
  funnel2.position.set(-5.5, 4.6, 0);
  g.add(funnel2);

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.09, 7.5, 6),
    mat(0x3a4242, { metalness: 0.6, roughness: 0.4 }),
  );
  mast.position.set(1.2, 7.2, 0);
  g.add(mast);

  const gun = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.2, 3.4, 8),
    mat(0x2a3030, { metalness: 0.65, roughness: 0.4 }),
  );
  gun.rotation.z = Math.PI / 2;
  gun.position.set(9.2, 3.35, 0);
  g.add(gun);

  const aftGun = gun.clone();
  aftGun.position.set(-9.5, 3.1, 0);
  g.add(aftGun);

  g.scale.setScalar(0.58);
  return g;
}

export function createMerchant(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'merchant';

  g.add(createTaperedHull(38, 6.8, 3.4, 0x232a2c));

  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(30, 0.32, 5.6),
    mat(DECK, { metalness: 0.48, roughness: 0.5 }),
  );
  deck.position.set(-1.2, 3.45, 0);
  deck.castShadow = true;
  g.add(deck);

  // Cargo islands — stacked boxes read as holds from oblique
  for (let i = 0; i < 3; i++) {
    const hold = new THREE.Mesh(
      new THREE.BoxGeometry(6.2, 1.8, 4.6),
      mat(0x3a342e, { roughness: 0.7, metalness: 0.25 }),
    );
    hold.position.set(9 - i * 8.5, 4.5, 0);
    hold.castShadow = true;
    g.add(hold);
    const hatch = new THREE.Mesh(
      new THREE.BoxGeometry(4.2, 0.25, 3.2),
      mat(0x2a2622, { roughness: 0.65 }),
    );
    hatch.position.set(9 - i * 8.5, 5.5, 0);
    g.add(hatch);
  }

  addDeckHouse(g, -13.5, 5.4, 0, 5.2, 4.2, 5.0);
  addDeckHouse(g, -13.5, 7.9, 0, 3.4, 1.2, 3.6, DECK);

  const funnel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.85, 1.05, 4.2, 10),
    mat(0x4a3a28, { metalness: 0.35, roughness: 0.55 }),
  );
  funnel.position.set(-13.5, 9.5, 0);
  funnel.castShadow = true;
  g.add(funnel);

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.1, 8, 6),
    mat(0x3a4040, { metalness: 0.55 }),
  );
  mast.position.set(4, 8.2, 0);
  g.add(mast);

  g.scale.setScalar(0.52);
  return g;
}

export function createPatrolBoat(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'patrol';
  g.add(createTaperedHull(18, 3.1, 1.7, 0x385255));
  addDeckHouse(g, -1, 2.9, 0, 4.8, 1.8, 2.2, 0xe0ded0);
  const radar = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), mat(0xe8ece6, { metalness: 0.2 }));
  radar.position.set(-1, 4.15, 0);
  g.add(radar);
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 2.1, 8), mat(DECK));
  gun.rotation.z = Math.PI / 2;
  gun.position.set(5.8, 2.35, 0);
  g.add(gun);
  g.scale.setScalar(0.62);
  return g;
}

export function createCruiser(): THREE.Group {
  const g = createDestroyer();
  g.name = 'cruiser';
  g.scale.multiplyScalar(1.6);
  for (const x of [5.6, -6.5, -11]) {
    const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.0, 0.6, 10), mat(HULL_LIGHT));
    turret.position.set(x, 3.9, 0);
    g.add(turret);
  }
  return g;
}

export function createBattleship(): THREE.Group {
  const g = createCruiser();
  g.name = 'battleship';
  g.scale.multiplyScalar(1.45);
  for (const x of [8, 1, -8]) {
    const barbette = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.35, 0.75, 12), mat(0x465052));
    barbette.position.set(x, 4.2, 0);
    g.add(barbette);
    for (const z of [-0.42, 0.42]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 4.5, 8), mat(DECK));
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(x + 1.9, 4.45, z);
      g.add(barrel);
    }
  }
  return g;
}

export function createUboat(): THREE.Group {
  const g = createSubmarine();
  g.name = 'uboat';
  g.scale.multiplyScalar(1.48);
  const conningTower = new THREE.Mesh(new THREE.BoxGeometry(3.3, 1.4, 1.5), mat(0x283236));
  conningTower.position.set(-0.7, 3.6, 0);
  g.add(conningTower);
  return g;
}

export function createAircraft(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'aircraft';
  const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 4.2, 4, 10), mat(0x40544b));
  fuselage.rotation.z = Math.PI / 2;
  g.add(fuselage);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 7.2), mat(0x53685c));
  wing.position.y = 0.05;
  g.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 0.12), mat(0x53685c));
  tail.position.set(-2.1, 0.62, 0);
  g.add(tail);
  return g;
}

export function createFob(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'fob';
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(7, 8, 1.1, 24), mat(0x7f7455, { roughness: 0.9 }));
  platform.position.y = 0.45;
  g.add(platform);
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 3.2, 7, 12), mat(0xd5d1bd));
  tower.position.y = 4.2;
  g.add(tower);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), new THREE.MeshStandardMaterial({ color: 0xff4939, emissive: 0xff2200, emissiveIntensity: 1.8 }));
  beacon.position.y = 8.1;
  g.add(beacon);
  return g;
}

export function createTorpedo(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'torpedo';
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 1.25, 4, 8), mat(0x263236, { metalness: 0.72 }));
  body.rotation.z = Math.PI / 2;
  g.add(body);
  const prop = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.58, 0.58), mat(BRASS));
  prop.position.x = -0.82;
  g.add(prop);
  return g;
}

export function createCrate(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'crate';
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 1.1), mat(0x8b5a30, { roughness: 0.85, metalness: 0.04 }));
  g.add(box);
  const strap = new THREE.Mesh(new THREE.BoxGeometry(1.46, 1.05, 0.12), mat(0x33302b));
  g.add(strap);
  return g;
}

/** Restrained Kelvin-style V wake — apex at ship stern, arms taper aft. */
export function createWakeRibbon(): THREE.Mesh {
  const length = 18;
  const spread = 3.2;
  const inner = 0.35;
  // X aft-negative, Z lateral; Y up
  const positions = new Float32Array([
    // left arm
    0,
    0,
    0,
    -length,
    0,
    -spread,
    -length * 0.15,
    0,
    -inner,
    // right arm
    0,
    0,
    0,
    -length * 0.15,
    0,
    inner,
    -length,
    0,
    spread,
  ]);
  const colors = new Float32Array([
    0.85, 0.9, 0.88, 0.55, 0.62, 0.6, 0.7, 0.76, 0.74, 0.85, 0.9, 0.88, 0.7, 0.76, 0.74, 0.55, 0.62,
    0.6,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  return mesh;
}
