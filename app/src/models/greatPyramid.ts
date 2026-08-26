import * as THREE from "three";
import type { LandmarkModel } from "./flavianAmphitheatre";

/** A tactile stepped-paper reading of Khufu's Great Pyramid and inner passage. */
export function createGreatPyramid(): LandmarkModel {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(value: T) => { disposables.push(value); return value; };

  const paper = track(new THREE.MeshStandardMaterial({ color: 0xf4ead0, roughness: 0.98, side: THREE.DoubleSide }));
  const limestone = track(new THREE.MeshStandardMaterial({ color: 0xd7bd84, roughness: 0.91, emissive: 0xffb45e, emissiveIntensity: 0 }));
  const casing = track(new THREE.MeshStandardMaterial({ color: 0xead9ab, roughness: 0.8, emissive: 0xffc977, emissiveIntensity: 0 }));
  const chamberMaterial = track(new THREE.MeshStandardMaterial({ color: 0x38291f, roughness: 0.9 }));
  const passageMaterial = track(new THREE.MeshStandardMaterial({ color: 0xf2a23d, roughness: 0.42, emissive: 0xff7f20, emissiveIntensity: 0.72 }));
  const emissiveMaterials = [limestone, casing, passageMaterial];

  const plateGeometry = track(new THREE.CircleGeometry(1.9, 72));
  plateGeometry.scale(1.18, 0.84, 1);
  const plate = new THREE.Mesh(plateGeometry, paper);
  plate.rotation.x = -Math.PI / 2;
  plate.receiveShadow = true;
  group.add(plate);

  const levels = 22;
  for (let level = 0; level < levels; level += 1) {
    const t = level / levels;
    const size = 2.65 * (1 - t * 0.91);
    const height = 0.075;
    const geometry = track(new THREE.BoxGeometry(size, height, size));
    const tier = new THREE.Mesh(geometry, level > levels - 4 ? casing : limestone);
    tier.position.y = height / 2 + level * height;
    tier.castShadow = tier.receiveShadow = true;
    group.add(tier);
  }

  const cap = new THREE.Mesh(track(new THREE.ConeGeometry(0.17, 0.24, 4)), casing);
  cap.rotation.y = Math.PI / 4;
  cap.position.y = levels * 0.075 + 0.12;
  cap.castShadow = true;
  group.add(cap);

  // A dark cutaway plate and illuminated ascending passage make the interior
  // legible without pretending to be an archaeological reconstruction.
  const cutawayShape = new THREE.Shape();
  cutawayShape.moveTo(-0.52, 0);
  cutawayShape.lineTo(0, 1.54);
  cutawayShape.lineTo(0.52, 0);
  cutawayShape.closePath();
  const cutaway = new THREE.Mesh(track(new THREE.ShapeGeometry(cutawayShape)), chamberMaterial);
  cutaway.position.set(0, 0.03, 1.34);
  group.add(cutaway);

  const passageCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.02, 0.11, 1.38),
    new THREE.Vector3(-0.1, 0.42, 1.39),
    new THREE.Vector3(0.08, 0.78, 1.4),
    new THREE.Vector3(0.04, 1.12, 1.4),
  ]);
  const passage = new THREE.Mesh(track(new THREE.TubeGeometry(passageCurve, 36, 0.035, 8, false)), passageMaterial);
  group.add(passage);

  const chamber = new THREE.Mesh(track(new THREE.BoxGeometry(0.3, 0.17, 0.08)), passageMaterial);
  chamber.position.set(0.04, 0.93, 1.42);
  chamber.castShadow = true;
  group.add(chamber);

  const dayColors = [paper, limestone, casing].map((material) => material.color.clone());
  const nightColors = dayColors.map((color) => color.clone().lerp(new THREE.Color(0x4a3828), 0.52));

  return {
    group,
    emissiveMaterials,
    applyNight: (amount) => {
      [paper, limestone, casing].forEach((material, index) => material.color.copy(dayColors[index]).lerp(nightColors[index], amount));
      passageMaterial.emissiveIntensity = 0.72 + amount * 1.4;
    },
    dispose: () => disposables.forEach((item) => item.dispose()),
  };
}
