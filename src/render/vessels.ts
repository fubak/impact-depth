import * as THREE from 'three';

const HULL = 0x243032;
const HULL_LIGHT = 0x3a484a;
const BRASS = 0xbd8b4e;
const DECK = 0x1a2224;
const SUPER = 0x2a3234;
const FUNNEL = 0x3a322c;
const hullAlbedo =
  typeof document === 'undefined'
    ? null
    : new THREE.TextureLoader().load('/assets/textures/hull-metal-albedo.png');
if (hullAlbedo) {
  hullAlbedo.colorSpace = THREE.SRGBColorSpace;
  hullAlbedo.wrapS = THREE.RepeatWrapping;
  hullAlbedo.wrapT = THREE.RepeatWrapping;
  hullAlbedo.repeat.set(2, 1);
}

function mat(
  color: number,
  opts: { metalness?: number; roughness?: number; flat?: boolean } = {},
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color,
    metalness: opts.metalness ?? 0.42,
    roughness: opts.roughness ?? 0.55,
    flatShading: opts.flat ?? false,
    side: THREE.FrontSide,
    shadowSide: THREE.FrontSide,
  });
  if (hullAlbedo && opts.metalness && opts.metalness > 0.3) material.map = hullAlbedo;
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
    bevelSegments: 5,
    curveSegments: 8,
    steps: 2,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, height * 0.5, 0);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, mat(color, { roughness: 0.58, metalness: 0.38 }));
  mesh.name = 'hull-body';
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

  // Pressure hull — longer, slightly flattened fleet-boat silhouette
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.92, 12.4, 12, 28),
    mat(0x1a262c, { roughness: 0.48, metalness: 0.52 }),
  );
  body.rotation.z = Math.PI / 2;
  body.scale.set(1, 0.86, 1);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // Soft belly underlight for underwater readability
  const fill = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.7, 10.2, 4, 12),
    new THREE.MeshStandardMaterial({
      color: 0x2a4550,
      roughness: 0.72,
      metalness: 0.12,
      emissive: 0x163848,
      emissiveIntensity: 0.42,
    }),
  );
  fill.rotation.z = Math.PI / 2;
  fill.position.y = -0.12;
  g.add(fill);

  // Bulbous bow / sonar dome
  const bow = new THREE.Mesh(
    new THREE.SphereGeometry(0.95, 22, 16),
    mat(HULL_LIGHT, { roughness: 0.42, metalness: 0.48 }),
  );
  bow.scale.set(1.35, 0.78, 0.9);
  bow.position.set(7.1, -0.05, 0);
  bow.castShadow = true;
  g.add(bow);

  // Deck casing strip
  const casing = new THREE.Mesh(
    new THREE.BoxGeometry(11.5, 0.35, 1.55),
    mat(DECK, { metalness: 0.45, roughness: 0.5 }),
  );
  casing.position.set(0.2, 0.78, 0);
  casing.castShadow = true;
  g.add(casing);

  // Fairwater / sail with slight taper
  const sail = new THREE.Mesh(
    new THREE.BoxGeometry(2.8, 2.85, 1.05),
    mat(SUPER, { metalness: 0.55, roughness: 0.42 }),
  );
  sail.position.set(-0.55, 2.0, 0);
  sail.castShadow = true;
  g.add(sail);
  const sailCap = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 0.32, 0.9),
    mat(DECK, { metalness: 0.5 }),
  );
  sailCap.position.set(-0.45, 3.5, 0);
  g.add(sailCap);
  const sailBridge = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.55, 0.95),
    mat(0x3a484c, { metalness: 0.4, roughness: 0.45 }),
  );
  sailBridge.position.set(0.35, 2.55, 0);
  g.add(sailBridge);

  // Twin periscopes + snorkel mast
  for (const [x, h, color] of [
    [0.55, 3.1, BRASS],
    [0.15, 2.7, 0x4a5254],
    [-0.35, 2.4, 0x3a4446],
  ] as const) {
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.065, h, 6),
      mat(color, { metalness: 0.7, roughness: 0.35 }),
    );
    mast.position.set(x, 3.55 + h * 0.25, 0.08);
    g.add(mast);
  }

  // Bow planes
  const divePlane = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 2.8), mat(HULL_LIGHT));
  divePlane.position.set(4.2, 0.2, 0);
  g.add(divePlane);

  // Stern planes + rudder
  const sternPlane = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 2.4), mat(HULL_LIGHT));
  sternPlane.position.set(-6.2, 0.15, 0);
  g.add(sternPlane);
  const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.9, 0.08), mat(HULL_LIGHT));
  rudder.position.set(-6.65, 0.55, 0);
  g.add(rudder);

  // Screws
  for (const z of [-0.35, 0.35]) {
    const prop = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.32, 8),
      mat(BRASS, { metalness: 0.85, roughness: 0.28 }),
    );
    prop.rotation.z = Math.PI / 2;
    prop.position.set(-7.05, -0.05, z);
    g.add(prop);
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.55, 0.12),
      mat(BRASS, { metalness: 0.8 }),
    );
    blade.position.set(-7.05, -0.05, z);
    g.add(blade);
  }

  // Deck gun for silhouette interest
  const gunMount = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.34, 0.35, 8),
    mat(0x2a3032, { metalness: 0.55 }),
  );
  gunMount.position.set(2.6, 1.15, 0);
  g.add(gunMount);
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.09, 1.8, 8),
    mat(0x2a3032, { metalness: 0.6 }),
  );
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(3.45, 1.35, 0);
  g.add(barrel);

  // Running light
  const nav = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 6),
    new THREE.MeshStandardMaterial({
      color: 0xe8dcc0,
      emissive: 0xffe8a8,
      emissiveIntensity: 0.85,
      roughness: 0.35,
    }),
  );
  nav.position.set(-0.4, 3.75, 0);
  g.add(nav);

  g.scale.setScalar(0.92);
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
    new THREE.CylinderGeometry(0.55, 0.75, 3.2, 16),
    mat(FUNNEL, { metalness: 0.4, roughness: 0.55 }),
  );
  funnel.position.set(-2.8, 5.0, 0);
  funnel.castShadow = true;
  g.add(funnel);

  const funnel2 = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.6, 2.6, 16),
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

  const yard = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 3.2), mat(0x3a4242));
  yard.position.set(1.2, 9.4, 0);
  g.add(yard);

  const radar = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.9, 0.12),
    mat(0x8a8e86, { metalness: 0.35, roughness: 0.45 }),
  );
  radar.position.set(1.05, 10.6, 0);
  g.add(radar);

  // Port/starboard railings for silhouette depth
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(18, 0.12, 0.06),
      mat(DECK, { metalness: 0.4 }),
    );
    rail.position.set(-1, 2.95, side * 1.85);
    g.add(rail);
  }

  addDeckHouse(g, -7.2, 3.55, 0, 2.8, 1.4, 2.4, DECK);

  const gun = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.2, 3.4, 12),
    mat(0x2a3030, { metalness: 0.65, roughness: 0.4 }),
  );
  gun.rotation.z = Math.PI / 2;
  gun.position.set(9.2, 3.35, 0);
  g.add(gun);

  const aftGun = gun.clone();
  aftGun.position.set(-9.5, 3.1, 0);
  g.add(aftGun);

  const searchlight = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 8, 6),
    new THREE.MeshStandardMaterial({
      color: 0xe8e0c8,
      emissive: 0xfff2c8,
      emissiveIntensity: 0.65,
      roughness: 0.35,
      metalness: 0.2,
    }),
  );
  searchlight.position.set(2.6, 6.35, 0);
  g.add(searchlight);

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
    new THREE.CylinderGeometry(0.85, 1.05, 4.2, 16),
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

  const boom = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.12, 0.12), mat(0x3a4040));
  boom.position.set(5.8, 10.4, 0.35);
  boom.rotation.z = -0.35;
  g.add(boom);

  for (const side of [-1, 1]) {
    const raft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.45, 0.35, 8),
      mat(0xc45a3a, { roughness: 0.7, metalness: 0.1 }),
    );
    raft.rotation.z = Math.PI / 2;
    raft.position.set(-11.5, 4.1, side * 2.7);
    g.add(raft);
  }

  g.scale.setScalar(0.52);
  return g;
}

export function createPatrolBoat(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'patrol';
  g.add(createTaperedHull(18, 3.1, 1.7, 0x385255));
  addDeckHouse(g, -1, 2.9, 0, 4.8, 1.8, 2.2, 0xe0ded0);
  const radar = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 10, 8),
    mat(0xe8ece6, { metalness: 0.2 }),
  );
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
  const g = new THREE.Group();
  g.name = 'cruiser';
  g.add(createTaperedHull(34, 5.2, 2.8, 0x2c3a3e));
  const deck = new THREE.Mesh(new THREE.BoxGeometry(24, 0.28, 4.2), mat(DECK, { metalness: 0.45 }));
  deck.position.set(-0.5, 2.95, 0);
  g.add(deck);
  addDeckHouse(g, 3.5, 4.6, 0, 6.5, 3.2, 3.6);
  addDeckHouse(g, 3.2, 6.6, 0, 3.6, 1.1, 2.6, DECK);
  for (const x of [8.5, -6.5, -12]) {
    const barbette = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 1.1, 0.7, 20),
      mat(HULL_LIGHT),
    );
    barbette.position.set(x, 3.5, 0);
    g.add(barbette);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 4.2, 8), mat(DECK));
    barrel.rotation.z = Math.PI / 2;
    barrel.position.set(x + 1.8, 3.65, 0);
    g.add(barrel);
  }
  for (const x of [-1.5, -4.2]) {
    const funnel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.75, 3.6, 10),
      mat(FUNNEL, { metalness: 0.3 }),
    );
    funnel.position.set(x, 5.6, 0);
    g.add(funnel);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 9, 6), mat(0x3a4040));
  mast.position.set(2.2, 8.2, 0);
  g.add(mast);
  g.scale.setScalar(0.55);
  return g;
}

export function createBattleship(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'battleship';
  g.add(createTaperedHull(42, 6.4, 3.4, 0x243034));
  const deck = new THREE.Mesh(new THREE.BoxGeometry(30, 0.35, 5.2), mat(DECK, { metalness: 0.48 }));
  deck.position.set(-1, 3.55, 0);
  g.add(deck);
  addDeckHouse(g, 2.0, 5.6, 0, 8.5, 4.0, 4.4);
  addDeckHouse(g, 1.5, 8.0, 0, 4.5, 1.4, 3.2, DECK);
  for (const x of [11, 4, -8, -14]) {
    const barbette = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.45, 0.9, 22), mat(0x465052));
    barbette.position.set(x, 4.1, 0);
    g.add(barbette);
    for (const z of [-0.55, 0.55]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 5.8, 8), mat(DECK));
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(x + 2.4, 4.4, z);
      g.add(barrel);
    }
  }
  for (const x of [-2, -5.5]) {
    const funnel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.95, 4.4, 10),
      mat(0x3a2e28, { metalness: 0.28 }),
    );
    funnel.position.set(x, 6.8, 0);
    g.add(funnel);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 11, 6), mat(0x3a4040));
  mast.position.set(0.5, 10.5, 0);
  g.add(mast);
  g.scale.setScalar(0.48);
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
  const fuse = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.42, 5.4, 10, 20),
    mat(0x4a6458, { roughness: 0.48, metalness: 0.28 }),
  );
  fuse.rotation.z = Math.PI / 2;
  fuse.castShadow = true;
  g.add(fuse);
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.4, 1.1, 10),
    mat(0x2a3430, { metalness: 0.35 }),
  );
  nose.rotation.z = -Math.PI / 2;
  nose.position.x = 3.4;
  g.add(nose);
  const cockpit = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({
      color: 0x9fd0dc,
      roughness: 0.22,
      metalness: 0.05,
      transparent: true,
      opacity: 0.75,
    }),
  );
  cockpit.position.set(1.1, 0.42, 0);
  g.add(cockpit);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 9.2), mat(0x5a7264));
  wing.position.set(0.2, 0.05, 0);
  wing.castShadow = true;
  g.add(wing);
  for (const side of [-1, 1]) {
    const eng = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.28, 1.4, 4, 8),
      mat(0x323a38, { metalness: 0.45 }),
    );
    eng.rotation.z = Math.PI / 2;
    eng.position.set(0.15, -0.2, side * 2.4);
    g.add(eng);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 3.1), mat(0x5a7264));
  tail.position.set(-2.5, 0.35, 0);
  g.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.35, 0.12), mat(0x5a7264));
  fin.position.set(-2.55, 0.85, 0);
  g.add(fin);
  return g;
}

export function createFob(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'fob';
  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(9.2, 10.5, 1.35, 28),
    mat(0x8a8060, { roughness: 0.88, metalness: 0.08 }),
  );
  deck.position.y = 0.55;
  deck.receiveShadow = true;
  g.add(deck);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.55, 3.2, 8),
      mat(0x3a4040, { metalness: 0.4 }),
    );
    leg.position.set(Math.cos(a) * 6.8, -0.9, Math.sin(a) * 6.8);
    g.add(leg);
  }
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 3.6, 8.2, 14),
    mat(0xd8d4c4, { roughness: 0.62, metalness: 0.12 }),
  );
  tower.position.y = 5.0;
  tower.castShadow = true;
  g.add(tower);
  addDeckHouse(g, 0, 9.4, 0, 4.2, 1.4, 4.2, DECK);
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.14, 5.5, 6),
    mat(0x3a4040, { metalness: 0.55 }),
  );
  mast.position.set(0.4, 12.2, 0);
  g.add(mast);
  const radar = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 0.2), mat(0xc8c4b0));
  radar.position.set(0.5, 13.4, 0);
  g.add(radar);
  const cranePost = new THREE.Mesh(new THREE.BoxGeometry(0.55, 4.2, 0.55), mat(0x4a5048));
  cranePost.position.set(5.2, 2.8, 4.8);
  g.add(cranePost);
  const boom = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.28, 0.28), mat(0x5a6058));
  boom.position.set(7.6, 4.8, 4.8);
  boom.rotation.z = -0.28;
  g.add(boom);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 12, 10),
    new THREE.MeshStandardMaterial({
      color: 0xff4939,
      emissive: 0xff2200,
      emissiveIntensity: 1.6,
    }),
  );
  beacon.position.y = 15.0;
  g.add(beacon);
  return g;
}

export function createTorpedo(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'torpedo';
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.16, 1.25, 4, 8),
    mat(0x263236, { metalness: 0.72 }),
  );
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
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 1.0, 1.1),
    mat(0x8b5a30, { roughness: 0.85, metalness: 0.04 }),
  );
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
