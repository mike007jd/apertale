import * as THREE from "three";

/**
 * A procedural Flavian Amphitheatre (Colosseum) built entirely from Three.js
 * geometry: an elliptical travertine facade of four storeys, a surviving inner
 * arcade, the sloped cavea, a half-open arena floor and the hypogeum beneath.
 *
 * The model is authored Y-up in its own space and mounted by the renderer onto
 * a page-aligned pivot, so it reads as a paper pop-up standing off the spread.
 */

export type LandmarkModel = {
  group: THREE.Group;
  /** Materials whose emissive is driven by the hover/focus interaction schema. */
  emissiveMaterials: THREE.MeshStandardMaterial[];
  /** Warm/cool material tint applied by the Day/Night presentation preset. */
  applyNight: (nightAmount: number) => void;
  dispose: () => void;
};

const OUTER_A = 1.5;
const OUTER_B = 1.2;
const WALL = 0.13;
const SEGMENTS = 56;
/** Fraction of the ring where the outer facade survives, as in Rome today. */
const PRESERVED = 0.6;
/** Arch openings are sized from the bay width so real piers stay between them. */
const STOREYS = [
  { height: 0.3, archRatio: 0.56, archHeight: 0.22 },
  { height: 0.28, archRatio: 0.54, archHeight: 0.2 },
  { height: 0.26, archRatio: 0.52, archHeight: 0.185 },
];
const ATTIC_HEIGHT = 0.24;

function archPanel(width: number, height: number, archWidth: number, archHeight: number, thickness: number) {
  const shape = new THREE.Shape();
  const halfWidth = width / 2;
  shape.moveTo(-halfWidth, 0);
  shape.lineTo(halfWidth, 0);
  shape.lineTo(halfWidth, height);
  shape.lineTo(-halfWidth, height);
  shape.closePath();

  const halfArch = archWidth / 2;
  const springline = Math.max(0.02, archHeight - halfArch);
  const hole = new THREE.Path();
  hole.moveTo(-halfArch, 0.015);
  hole.lineTo(-halfArch, springline);
  hole.absarc(0, springline, halfArch, Math.PI, 0, true);
  hole.lineTo(halfArch, 0.015);
  hole.closePath();
  shape.holes.push(hole);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelSize: 0.005,
    bevelThickness: 0.005,
    bevelSegments: 1,
    curveSegments: 9,
  });
  geometry.translate(0, 0, -thickness / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function solidPanel(width: number, height: number, thickness: number) {
  const geometry = new THREE.BoxGeometry(width, height, thickness);
  geometry.translate(0, height / 2, 0);
  return geometry;
}

/** Elliptical open ring used for cornices and the string courses between storeys. */
function ringGeometry(a: number, b: number, thickness: number, fromAngle: number, toAngle: number) {
  const geometry = new THREE.CylinderGeometry(1, 1, thickness, SEGMENTS, 1, true, Math.PI / 2 - toAngle, toAngle - fromAngle);
  geometry.scale(a, 1, b);
  return geometry;
}

type InstancedSpec = {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  count: number;
};

function buildInstanced({ geometry, material, count }: InstancedSpec) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

export function createFlavianAmphitheatre(): LandmarkModel {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(value: T) => {
    disposables.push(value);
    return value;
  };

  const travertine = track(new THREE.MeshStandardMaterial({ color: 0xd8c6a2, roughness: 0.86, metalness: 0.02 }));
  const weathered = track(new THREE.MeshStandardMaterial({ color: 0xcbb794, roughness: 0.92, metalness: 0.01 }));
  const brick = track(new THREE.MeshStandardMaterial({ color: 0xb08c6d, roughness: 0.95, metalness: 0 }));
  const seating = track(new THREE.MeshStandardMaterial({ color: 0xb9a17c, roughness: 0.97, metalness: 0, side: THREE.DoubleSide }));
  const sand = track(new THREE.MeshStandardMaterial({ color: 0xe0cda6, roughness: 1, metalness: 0 }));
  const paperPlate = track(new THREE.MeshStandardMaterial({ color: 0xf6efdd, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }));
  const emissiveMaterials = [travertine, weathered, brick, seating, sand];
  emissiveMaterials.forEach((material) => {
    material.emissive = new THREE.Color(0xffb570);
    material.emissiveIntensity = 0;
  });

  const dayTints = new Map<THREE.MeshStandardMaterial, THREE.Color>();
  const nightTints = new Map<THREE.MeshStandardMaterial, THREE.Color>();
  [travertine, weathered, brick, seating, sand, paperPlate].forEach((material) => {
    dayTints.set(material, material.color.clone());
    nightTints.set(material, material.color.clone().lerp(new THREE.Color(0x6f5a46), 0.42));
  });

  // Pop-up mounting plate and stone stylobate.
  const plate = new THREE.Mesh(track(new THREE.CircleGeometry(1, 72)), paperPlate);
  plate.geometry.scale(OUTER_A + 0.28, OUTER_B + 0.26, 1);
  plate.rotation.x = -Math.PI / 2;
  plate.receiveShadow = true;
  group.add(plate);

  const stylobate = new THREE.Mesh(track(new THREE.CylinderGeometry(1, 1, 0.07, 72)), weathered);
  stylobate.geometry.scale(OUTER_A + 0.1, 1, OUTER_B + 0.1);
  stylobate.position.y = 0.035;
  stylobate.castShadow = stylobate.receiveShadow = true;
  group.add(stylobate);

  const step = new THREE.Mesh(track(new THREE.CylinderGeometry(1, 1, 0.035, 72)), travertine);
  step.geometry.scale(OUTER_A + 0.19, 1, OUTER_B + 0.18);
  step.position.y = 0.017;
  step.receiveShadow = true;
  group.add(step);

  const base = 0.07;
  const preservedFrom = -Math.PI * 0.22;
  const preservedTo = preservedFrom + Math.PI * 2 * PRESERVED;

  const angleAt = (index: number, count: number, from: number, to: number) => from + ((to - from) * index) / count;
  const pointOn = (angle: number, a: number, b: number) => new THREE.Vector3(a * Math.cos(angle), 0, b * Math.sin(angle));

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();

  /** Places `count` panels along an elliptical arc, facing outward. */
  function layout(
    mesh: THREE.InstancedMesh,
    count: number,
    a: number,
    b: number,
    from: number,
    to: number,
    y: number,
    baseWidth: number,
    taper: boolean,
  ) {
    for (let index = 0; index < count; index += 1) {
      const angle = angleAt(index + 0.5, count, from, to);
      const point = pointOn(angle, a, b);
      const next = pointOn(angleAt(index + 1, count, from, to), a, b);
      const previous = pointOn(angleAt(index, count, from, to), a, b);
      const span = previous.distanceTo(next);
      const outward = new THREE.Vector3(point.x / (a * a), 0, point.z / (b * b)).normalize();
      euler.set(0, Math.atan2(outward.x, outward.z), 0);
      quaternion.setFromEuler(euler);
      const edge = taper ? Math.min(1, Math.min(index, count - 1 - index) / 3.2) : 1;
      const heightScale = taper ? 0.55 + 0.45 * edge : 1;
      position.set(point.x, y, point.z);
      scale.set((span / baseWidth) * 1.02, heightScale, 1);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  // Surviving outer facade: three arcades plus the attic wall.
  const preservedCount = Math.round(SEGMENTS * PRESERVED);
  let level = base;
  STOREYS.forEach((storey, storeyIndex) => {
    const width = (2 * Math.PI * ((OUTER_A + OUTER_B) / 2) * PRESERVED) / preservedCount;
    const geometry = track(archPanel(width, storey.height, width * storey.archRatio, storey.archHeight, WALL));
    const mesh = buildInstanced({
      geometry,
      material: storeyIndex === 2 ? weathered : travertine,
      count: preservedCount,
    });
    layout(mesh, preservedCount, OUTER_A, OUTER_B, preservedFrom, preservedTo, level, width, true);
    group.add(mesh);

    const cornice = new THREE.Mesh(track(ringGeometry(OUTER_A + 0.035, OUTER_B + 0.035, 0.028, preservedFrom, preservedTo)), travertine);
    cornice.position.y = level + storey.height;
    cornice.castShadow = cornice.receiveShadow = true;
    cornice.material.side = THREE.DoubleSide;
    group.add(cornice);
    level += storey.height;
  });

  const atticWidth = (2 * Math.PI * ((OUTER_A + OUTER_B) / 2) * PRESERVED) / preservedCount;
  const attic = buildInstanced({
    geometry: track(solidPanel(atticWidth, ATTIC_HEIGHT, WALL * 0.86)),
    material: weathered,
    count: preservedCount,
  });
  layout(attic, preservedCount, OUTER_A, OUTER_B, preservedFrom, preservedTo, level, atticWidth, true);
  group.add(attic);

  const crown = new THREE.Mesh(track(ringGeometry(OUTER_A + 0.04, OUTER_B + 0.04, 0.03, preservedFrom + 0.14, preservedTo - 0.14)), travertine);
  crown.position.y = level + ATTIC_HEIGHT * 0.94;
  crown.material.side = THREE.DoubleSide;
  crown.castShadow = true;
  group.add(crown);

  // Inner arcade ring, which survives all the way round.
  const innerA = OUTER_A * 0.79;
  const innerB = OUTER_B * 0.79;
  const innerWidth = (2 * Math.PI * ((innerA + innerB) / 2)) / SEGMENTS;
  const innerRing = buildInstanced({
    geometry: track(archPanel(innerWidth, 0.42, innerWidth * 0.5, 0.24, WALL * 0.8)),
    material: brick,
    count: SEGMENTS,
  });
  layout(innerRing, SEGMENTS, innerA, innerB, 0, Math.PI * 2, base, innerWidth, false);
  group.add(innerRing);

  // Cavea: the sloped seating bowl between the inner ring and the arena.
  const cavea = new THREE.Mesh(track(new THREE.CylinderGeometry(1, 0.52, 0.42, SEGMENTS, 1, true)), seating);
  cavea.geometry.scale(innerA * 0.98, 1, innerB * 0.98);
  cavea.position.y = base + 0.22;
  cavea.material.side = THREE.DoubleSide;
  cavea.receiveShadow = true;
  group.add(cavea);

  // Readable seating tiers stepping down toward the arena.
  for (let tier = 0; tier < 6; tier += 1) {
    const factor = 0.56 + tier * 0.075;
    const stepRing = new THREE.Mesh(
      track(ringGeometry(innerA * factor, innerB * factor, 0.022, 0, Math.PI * 2)),
      tier % 2 === 0 ? brick : seating,
    );
    stepRing.position.y = base + 0.05 + tier * 0.065;
    stepRing.material.side = THREE.DoubleSide;
    stepRing.castShadow = stepRing.receiveShadow = true;
    group.add(stepRing);
  }

  // Arena: half sand floor, half exposed hypogeum, as the ruin reads today.
  const arenaA = innerA * 0.5;
  const arenaB = innerB * 0.5;
  const floor = new THREE.Mesh(track(new THREE.CircleGeometry(1, 48, Math.PI * 0.08, Math.PI)), sand);
  floor.geometry.scale(arenaA, arenaB, 1);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = base + 0.075;
  floor.receiveShadow = true;
  group.add(floor);

  const hypogeumWalls = 14;
  const hypogeum = buildInstanced({
    geometry: track(new THREE.BoxGeometry(0.02, 0.075, arenaB * 0.8)),
    material: brick,
    count: hypogeumWalls,
  });
  for (let index = 0; index < hypogeumWalls; index += 1) {
    const offset = (index / (hypogeumWalls - 1) - 0.5) * arenaA * 1.5;
    position.set(offset, base + 0.04, 0);
    euler.set(0, 0, 0);
    quaternion.setFromEuler(euler);
    const inset = Math.sqrt(Math.max(0.05, 1 - (offset / (arenaA * 0.98)) ** 2));
    scale.set(1, 1, inset);
    matrix.compose(position, quaternion, scale);
    hypogeum.setMatrixAt(index, matrix);
  }
  hypogeum.instanceMatrix.needsUpdate = true;
  group.add(hypogeum);

  for (let index = 0; index < 3; index += 1) {
    const factor = 0.34 + index * 0.3;
    const corridor = new THREE.Mesh(track(ringGeometry(arenaA * factor, arenaB * factor, 0.07, 0, Math.PI * 2)), brick);
    corridor.position.y = base + 0.04;
    corridor.material.side = THREE.DoubleSide;
    group.add(corridor);
  }

  const arenaFloorBed = new THREE.Mesh(track(new THREE.CircleGeometry(1, 48)), brick);
  arenaFloorBed.geometry.scale(arenaA * 1.02, arenaB * 1.02, 1);
  arenaFloorBed.rotation.x = -Math.PI / 2;
  arenaFloorBed.position.y = base + 0.005;
  arenaFloorBed.receiveShadow = true;
  group.add(arenaFloorBed);

  const applyNight = (nightAmount: number) => {
    dayTints.forEach((dayColor, material) => {
      const nightColor = nightTints.get(material);
      if (nightColor) material.color.copy(dayColor).lerp(nightColor, nightAmount);
    });
  };

  return {
    group,
    emissiveMaterials,
    applyNight,
    dispose: () => {
      disposables.forEach((item) => item.dispose());
      group.clear();
    },
  };
}
