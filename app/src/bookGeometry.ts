/**
 * The physical book's dimensions and the Three.js geometry built from them:
 * the two resting pages, the deforming turn leaf, and one scene element per
 * illustrated layer. Pure construction, no renderer and no React, so vertex
 * counts, UV halves and disposal can be asserted in node.
 */
import * as THREE from "three";
import { deformPageVertex, restingPageDepth } from "./pageDeformation";
import type { BookElement } from "./types";

export const PAGE_W = 4.2;
export const PAGE_H = 5.18;
export const PAGE_THICKNESS = 0.024;
/**
 * Case dimensions. BOARD_W x 2 plus the spine reproduces the previous 9.05
 * cover width for a five-spread book, so the open framing is unchanged; the
 * fore-edge squab of 0.07 is 1.35% of page height, which is where real
 * bookbinding puts it (about 3mm on a 210mm trim).
 */
export const BOARD_W = 4.27;
export const BOARD_H = 5.75;
export const BOARD_T = 0.055;
/** Endpapers, backbone and headbands, present regardless of extent. */
export const BODY_BASE = 0.2;
/** The groove between board and spine that lets the cover hinge. */
export const JOINT = 0.028;

export function makePageMaterial(side: THREE.Side) {
  return new THREE.MeshStandardMaterial({
    color: 0xfffbef,
    roughness: 0.82,
    metalness: 0,
    emissive: new THREE.Color(0x6b3d1e),
    emissiveIntensity: 0,
    side,
    polygonOffset: true,
    polygonOffsetFactor: side === THREE.FrontSide ? -1 : 1,
    polygonOffsetUnits: 1,
  });
}

export function makeOpenPageGeometry(side: "left" | "right") {
  const geometry = new THREE.PlaneGeometry(PAGE_W, PAGE_H, 40, 8);
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  const uvs = geometry.attributes.uv as THREE.BufferAttribute;
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const profileX = side === "left" ? -x : x;
    positions.setZ(index, restingPageDepth(profileX, y, PAGE_W, PAGE_H));
    const pageU = uvs.getX(index);
    uvs.setX(index, side === "left" ? pageU * 0.5 : 0.5 + pageU * 0.5);
  }
  uvs.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

type TurnLeaf = {
  geometry: THREE.BufferGeometry;
  update: (progress: number) => void;
};

/**
 * One watertight paper leaf with separately textured front and back faces.
 * The old implementation rendered two coplanar planes, which produced the
 * dark seams and apparent tears visible when a leaf was nearly edge-on.
 */
export function createTurnLeaf(): TurnLeaf {
  const widthSegments = 48;
  const heightSegments = 8;
  const columns = widthSegments + 1;
  const rows = heightSegments + 1;
  const surfaceVertexCount = columns * rows;
  const positions = new Float32Array(surfaceVertexCount * 2 * 3);
  const uvs = new Float32Array(surfaceVertexCount * 2 * 2);
  const base = new Float32Array(surfaceVertexCount * 2);
  const indices: number[] = [];

  for (let row = 0; row < rows; row += 1) {
    const v = row / heightSegments;
    const y = -PAGE_H / 2 + v * PAGE_H;
    for (let column = 0; column < columns; column += 1) {
      const u = column / widthSegments;
      const x = -PAGE_W / 2 + u * PAGE_W;
      const index = row * columns + column;
      base[index * 2] = x;
      base[index * 2 + 1] = y;
      uvs[index * 2] = u;
      uvs[index * 2 + 1] = v;
      const backIndex = surfaceVertexCount + index;
      uvs[backIndex * 2] = u;
      uvs[backIndex * 2 + 1] = v;
    }
  }

  const frontStart = indices.length;
  for (let row = 0; row < heightSegments; row += 1) {
    for (let column = 0; column < widthSegments; column += 1) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const frontCount = indices.length - frontStart;

  const backStart = indices.length;
  for (let row = 0; row < heightSegments; row += 1) {
    for (let column = 0; column < widthSegments; column += 1) {
      const a = surfaceVertexCount + row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const backCount = indices.length - backStart;

  const edgeStart = indices.length;
  const connect = (frontA: number, frontB: number) => {
    const backA = surfaceVertexCount + frontA;
    const backB = surfaceVertexCount + frontB;
    indices.push(frontA, backA, frontB, frontB, backA, backB);
  };
  for (let column = 0; column < widthSegments; column += 1) {
    connect(column, column + 1);
    const bottom = heightSegments * columns + column;
    connect(bottom + 1, bottom);
  }
  for (let row = 0; row < heightSegments; row += 1) {
    connect((row + 1) * columns, row * columns);
    connect(row * columns + widthSegments, (row + 1) * columns + widthSegments);
  }
  const edgeCount = indices.length - edgeStart;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.addGroup(frontStart, frontCount, 0);
  geometry.addGroup(backStart, backCount, 1);
  geometry.addGroup(edgeStart, edgeCount, 2);

  const point = new THREE.Vector3();
  const beforeX = new THREE.Vector3();
  const afterX = new THREE.Vector3();
  const beforeY = new THREE.Vector3();
  const afterY = new THREE.Vector3();
  const tangentX = new THREE.Vector3();
  const tangentY = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const xStep = PAGE_W / widthSegments;
  const yStep = PAGE_H / heightSegments;

  const sample = (target: THREE.Vector3, x: number, y: number, progress: number) => {
    const deformed = deformPageVertex(x, y, progress, PAGE_W, PAGE_H);
    target.set(deformed.x, deformed.y, deformed.z);
  };

  const update = (progress: number) => {
    for (let index = 0; index < surfaceVertexCount; index += 1) {
      const x = base[index * 2];
      const y = base[index * 2 + 1];
      sample(point, x, y, progress);
      sample(beforeX, Math.max(-PAGE_W / 2, x - xStep), y, progress);
      sample(afterX, Math.min(PAGE_W / 2, x + xStep), y, progress);
      sample(beforeY, x, Math.max(-PAGE_H / 2, y - yStep), progress);
      sample(afterY, x, Math.min(PAGE_H / 2, y + yStep), progress);
      tangentX.subVectors(afterX, beforeX);
      tangentY.subVectors(afterY, beforeY);
      normal.crossVectors(tangentX, tangentY).normalize();

      const frontOffset = index * 3;
      const backOffset = (surfaceVertexCount + index) * 3;
      positions[frontOffset] = point.x + normal.x * PAGE_THICKNESS / 2;
      positions[frontOffset + 1] = point.y + normal.y * PAGE_THICKNESS / 2;
      positions[frontOffset + 2] = point.z + normal.z * PAGE_THICKNESS / 2;
      positions[backOffset] = point.x - normal.x * PAGE_THICKNESS / 2;
      positions[backOffset + 1] = point.y - normal.y * PAGE_THICKNESS / 2;
      positions[backOffset + 2] = point.z - normal.z * PAGE_THICKNESS / 2;
    }
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  };

  update(0);
  return { geometry, update };
}

/**
 * One renderable scene element. The renderer knows nothing about specific
 * elements: hover, focus and reveal all come from the structured interaction
 * schema attached to the document data.
 */
export type SceneElement = {
  id: string;
  root: THREE.Group;
  /** Leans a pop-up out of the page; unused by flat cutouts. */
  tilt: THREE.Group;
  /** Carries hover lean and focus orbit. */
  yaw: THREE.Group;
  /** Where the HTML reveal card anchors. */
  anchor: THREE.Object3D;
  materials: THREE.MeshStandardMaterial[];
  frameTextures: THREE.Texture[];
  loadedFrameIndices: Set<number>;
  frameIndex: number;
  hoverAmount: number;
  focusAmount: number;
  spin: number;
  motionKey: string | null;
  motionStartedAt: number;
  dispose: () => void;
};

export function buildSceneElement(
  element: BookElement,
  textureLoader: THREE.TextureLoader,
  resolvedAssetUrl = element.assetId,
  resolvedFrameUrls = element.frameAssetIds ?? [],
  onTextureError?: (frameIndex: number) => void,
  onTextureReady?: () => void,
): SceneElement {
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  const yaw = new THREE.Group();
  root.add(tilt);
  tilt.add(yaw);
  root.userData.elementId = element.id;
  root.visible = false;

  const anchor = new THREE.Object3D();
  root.add(anchor);

  if (resolvedAssetUrl.startsWith("procedural:hotspot:")) {
    const tone = resolvedAssetUrl.split(":").at(-1) ?? "amber";
    const colors: Record<string, number> = {
      amber: 0xffc96b,
      aqua: 0x7fd2df,
      jade: 0x78c99a,
      rose: 0xff8f79,
    };
    const color = new THREE.Color(colors[tone] ?? colors.amber);
    const ringGeometry = new THREE.RingGeometry(0.105, 0.17, 40);
    const coreGeometry = new THREE.CircleGeometry(0.064, 32);
    const ringMaterial = new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity: 0.88,
      roughness: 0.44,
      emissive: color,
      emissiveIntensity: 0.08,
      side: THREE.DoubleSide,
    });
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: 0xfffbec,
      transparent: true,
      opacity: 0.96,
      roughness: 0.32,
      emissive: color,
      emissiveIntensity: 0.08,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    core.position.z = 0.012;
    yaw.add(ring, core);
    anchor.position.set(0, 0.24, 0.05);
    return {
      id: element.id,
      root,
      tilt,
      yaw,
      anchor,
      materials: [ringMaterial, coreMaterial],
      frameTextures: [],
      loadedFrameIndices: new Set([0]),
      frameIndex: 0,
      hoverAmount: 0,
      focusAmount: 0,
      spin: 0,
      motionKey: null,
      motionStartedAt: 0,
      dispose: () => {
        ringGeometry.dispose();
        coreGeometry.dispose();
        ringMaterial.dispose();
        coreMaterial.dispose();
      },
    };
  }

  const frameUrls = resolvedFrameUrls.length > 1 ? resolvedFrameUrls : [resolvedAssetUrl];
  let mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | null = null;
  const fitTextureAspect = (texture: THREE.Texture) => {
    if (!mesh) return;
    const image = texture.image as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number } | undefined;
    const width = image?.naturalWidth ?? image?.width ?? 1;
    const height = image?.naturalHeight ?? image?.height ?? 1;
    const aspect = width / Math.max(1, height);
    mesh.scale.set(aspect >= 1 ? 1 : aspect, aspect >= 1 ? 1 / aspect : 1, 1);
  };
  const loadedFrameIndices = new Set<number>();
  const frameTextures = frameUrls.map((url, index) => {
    const frameTexture = textureLoader.load(
      url,
      (texture) => {
        loadedFrameIndices.add(index);
        if (index === 0) fitTextureAspect(texture);
        onTextureReady?.();
      },
      undefined,
      () => onTextureError?.(index),
    );
    frameTexture.colorSpace = THREE.SRGBColorSpace;
    return frameTexture;
  });
  const material = new THREE.MeshStandardMaterial({
    map: frameTextures[0],
    transparent: true,
    alphaTest: 0.04,
    roughness: 0.75,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(0xffb570),
    emissiveIntensity: 0,
  });
  const size = element.id === "fox" ? 2 : 1.75;
  const geometry = new THREE.PlaneGeometry(size, size);
  mesh = new THREE.Mesh(geometry, material);
  if (frameTextures[0].image) fitTextureAspect(frameTextures[0]);
  mesh.castShadow = true;
  yaw.add(mesh);
  anchor.position.set(0, size * 0.34, 0.05);
  return {
    id: element.id,
    root,
    tilt,
    yaw,
    anchor,
    materials: [material],
    frameTextures,
    loadedFrameIndices,
    frameIndex: 0,
    hoverAmount: 0,
    focusAmount: 0,
    spin: 0,
    motionKey: null,
    motionStartedAt: 0,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      frameTextures.forEach((frameTexture) => frameTexture.dispose());
    },
  };
}

