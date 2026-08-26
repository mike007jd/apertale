import * as THREE from "three";
import type { LandmarkModel } from "./flavianAmphitheatre";

/** A cut-away stratovolcano: shell, strata, conduit, magma chamber, lava and ash. */
export function createVolcanoCrossSection(): LandmarkModel {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(value: T) => { disposables.push(value); return value; };

  const paper = track(new THREE.MeshStandardMaterial({ color: 0xf4ecd8, roughness: 0.98, side: THREE.DoubleSide }));
  const basalt = track(new THREE.MeshStandardMaterial({ color: 0x62564b, roughness: 0.96, side: THREE.DoubleSide }));
  const strataA = track(new THREE.MeshStandardMaterial({ color: 0x9b7358, roughness: 0.95, side: THREE.DoubleSide }));
  const strataB = track(new THREE.MeshStandardMaterial({ color: 0xc19a70, roughness: 0.94, side: THREE.DoubleSide }));
  const magma = track(new THREE.MeshStandardMaterial({ color: 0xff6b2c, roughness: 0.38, emissive: 0xff3d12, emissiveIntensity: 1.25 }));
  const hotCore = track(new THREE.MeshStandardMaterial({ color: 0xffd066, roughness: 0.28, emissive: 0xff7b22, emissiveIntensity: 1.7 }));
  const smoke = track(new THREE.MeshStandardMaterial({ color: 0xc8c1b7, roughness: 1, transparent: true, opacity: 0.68 }));
  const emissiveMaterials = [basalt, strataA, strataB, magma, hotCore];
  [basalt, strataA, strataB].forEach((material) => { material.emissive = new THREE.Color(0xff9a56); material.emissiveIntensity = 0; });

  const plateGeometry = track(new THREE.CircleGeometry(1.85, 72));
  plateGeometry.scale(1.18, 0.86, 1);
  const plate = new THREE.Mesh(plateGeometry, paper);
  plate.rotation.x = -Math.PI / 2;
  plate.receiveShadow = true;
  group.add(plate);

  // Leave a front wedge open so the chamber and conduit remain readable.
  const cutawayStart = Math.PI * 0.35;
  const cutawayLength = Math.PI * 1.3;
  const shellGeometry = track(new THREE.ConeGeometry(1.45, 2.05, 72, 12, true, cutawayStart, cutawayLength));
  const shell = new THREE.Mesh(shellGeometry, basalt);
  shell.position.y = 1.03;
  shell.castShadow = shell.receiveShadow = true;
  group.add(shell);

  const sectionShape = new THREE.Shape();
  sectionShape.moveTo(-1.27, 0);
  sectionShape.lineTo(0, 2.03);
  sectionShape.lineTo(1.27, 0);
  sectionShape.closePath();
  const section = new THREE.Mesh(track(new THREE.ShapeGeometry(sectionShape)), strataA);
  section.position.set(0, 0.03, 0.35);
  section.castShadow = true;
  group.add(section);

  [0.32, 0.61, 0.9, 1.19, 1.48].forEach((height, index) => {
    const halfWidth = 1.27 * (1 - height / 2.03);
    const geometry = track(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-halfWidth, height + 0.03, 0.37),
      new THREE.Vector3(halfWidth, height + 0.03, 0.37),
    ]));
    const material = track(new THREE.LineBasicMaterial({ color: index % 2 ? 0xe1b37d : 0x6f4b39 }));
    group.add(new THREE.Line(geometry, material));
  });

  const chamber = new THREE.Mesh(track(new THREE.SphereGeometry(0.43, 32, 20)), magma);
  chamber.scale.set(1.25, 0.62, 0.82);
  chamber.position.set(0, 0.32, 0.48);
  chamber.castShadow = true;
  group.add(chamber);

  const conduit = new THREE.Mesh(track(new THREE.CylinderGeometry(0.11, 0.16, 1.48, 20)), hotCore);
  conduit.position.set(0, 1.1, 0.47);
  conduit.castShadow = true;
  group.add(conduit);

  const sideVent = new THREE.Mesh(track(new THREE.CylinderGeometry(0.055, 0.085, 0.82, 14)), magma);
  sideVent.position.set(0.36, 1.16, 0.46);
  sideVent.rotation.z = -0.72;
  group.add(sideVent);

  const lavaCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.04, 2.06, 0),
    new THREE.Vector3(0.42, 1.72, 0.72),
    new THREE.Vector3(0.86, 1.18, 0.96),
    new THREE.Vector3(1.32, 0.42, 0.98),
  ]);
  const lava = new THREE.Mesh(track(new THREE.TubeGeometry(lavaCurve, 48, 0.055, 10, false)), magma);
  lava.castShadow = true;
  group.add(lava);

  const plume = new THREE.Group();
  [0.18, 0.24, 0.32, 0.39, 0.47].forEach((radius, index) => {
    const puff = new THREE.Mesh(track(new THREE.SphereGeometry(radius, 18, 12)), smoke);
    puff.position.set((index % 2 ? 0.12 : -0.08) * index, 2.28 + index * 0.27, (index - 2) * 0.035);
    puff.scale.y = 0.72;
    plume.add(puff);
  });
  group.add(plume);

  const dayColors = [basalt, strataA, strataB, paper].map((material) => material.color.clone());
  const nightColors = dayColors.map((color) => color.clone().lerp(new THREE.Color(0x332b28), 0.5));

  return {
    group,
    emissiveMaterials,
    applyNight: (amount) => {
      [basalt, strataA, strataB, paper].forEach((material, index) => material.color.copy(dayColors[index]).lerp(nightColors[index], amount));
      magma.emissiveIntensity = 1.25 + amount * 1.2;
      hotCore.emissiveIntensity = 1.7 + amount * 1.4;
      smoke.opacity = 0.68 - amount * 0.18;
    },
    dispose: () => disposables.forEach((item) => item.dispose()),
  };
}
