import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PAGE_THICKNESS, buildSceneElement, createTurnLeaf, makeOpenPageGeometry } from "./bookGeometry";
import type { BookElement } from "./types";

describe("makeOpenPageGeometry", () => {
  it("samples the left and right halves of one spread texture", () => {
    const left = makeOpenPageGeometry("left").attributes.uv as THREE.BufferAttribute;
    const right = makeOpenPageGeometry("right").attributes.uv as THREE.BufferAttribute;
    const range = (uv: THREE.BufferAttribute) => {
      let min = 1; let max = 0;
      for (let index = 0; index < uv.count; index += 1) { min = Math.min(min, uv.getX(index)); max = Math.max(max, uv.getX(index)); }
      return [min, max];
    };
    expect(range(left)).toEqual([0, 0.5]);
    expect(range(right)).toEqual([0.5, 1]);
  });
});

describe("createTurnLeaf", () => {
  it("builds one watertight leaf with front, back and edge groups", () => {
    const leaf = createTurnLeaf();
    const position = leaf.geometry.getAttribute("position") as THREE.BufferAttribute;
    const surfaceVertices = 49 * 9;
    expect(position.count).toBe(surfaceVertices * 2);
    expect(leaf.geometry.groups.map((group) => group.materialIndex)).toEqual([0, 1, 2]);
    expect(leaf.geometry.groups[2].count).toBeGreaterThan(0);
  });

  it("keeps the two faces one page thickness apart through the turn", () => {
    const leaf = createTurnLeaf();
    const position = leaf.geometry.getAttribute("position") as THREE.BufferAttribute;
    const surfaceVertices = 49 * 9;
    for (const progress of [0, 0.5, 1]) {
      leaf.update(progress);
      const front = new THREE.Vector3().fromBufferAttribute(position, 200);
      const back = new THREE.Vector3().fromBufferAttribute(position, surfaceVertices + 200);
      expect(Number.isFinite(front.x) && Number.isFinite(front.y) && Number.isFinite(front.z)).toBe(true);
      expect(front.distanceTo(back)).toBeCloseTo(PAGE_THICKNESS, 3);
    }
  });
});

describe("buildSceneElement", () => {
  const element = {
    id: "marker",
    label: "Marker",
    assetId: "procedural:hotspot:jade",
    page: "right",
    kind: "decoration",
    transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotationDeg: 0 },
    depth: 0,
    locked: false,
  } as unknown as BookElement;

  it("builds a procedural hotspot without touching the texture loader and disposes both meshes", () => {
    const loader = { load: () => { throw new Error("procedural markers must not load textures"); } } as unknown as THREE.TextureLoader;
    const scene = buildSceneElement(element, loader);
    expect(scene.root.userData.elementId).toBe("marker");
    expect(scene.root.visible).toBe(false);
    expect(scene.materials).toHaveLength(2);
    expect(scene.loadedFrameIndices.has(0)).toBe(true);
    expect(() => scene.dispose()).not.toThrow();
  });
});
