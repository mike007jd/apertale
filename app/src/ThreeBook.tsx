import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { isStoredAssetId, resolveAssetUrl } from "./assetStore";
import { recordDiagnostic } from "./diagnostics";
import { focusTraits, hoverTraits, motionTraits, resolveInteraction } from "./interaction";
import { createFlavianAmphitheatre, type LandmarkModel } from "./models/flavianAmphitheatre";
import { createGreatPyramid } from "./models/greatPyramid";
import { createVolcanoCrossSection } from "./models/volcanoCrossSection";
import { deformPageVertex } from "./pageTurn";
import type { BookElement, BookSnapshot, Spread, TurnState } from "./types";

export type BookSceneHandle = {
  canvas: HTMLCanvasElement | null;
};

type Props = {
  snapshot: BookSnapshot;
  turn: TurnState;
  onSelect: (elementId: string | null) => void;
  onHover: (elementId: string | null) => void;
  onMoveElement: (elementId: string, x: number, y: number) => void;
  onPageGesture: (direction: "forward" | "backward", phase: "start" | "move" | "end", amount: number) => void;
  onFailure: () => void;
};

type PagePair = {
  left: THREE.CanvasTexture;
  right: THREE.CanvasTexture;
  leftBack: THREE.CanvasTexture;
  rightBack: THREE.CanvasTexture;
};

const PAGE_W = 4.2;
const PAGE_H = 5.18;
/** How far a pop-up leans out of the page, in radians. */
const POPUP_TILT = THREE.MathUtils.degToRad(44);

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let line = "";
  text.split(" ").forEach((word) => {
    const test = `${line}${word} `;
    if (context.measureText(test).width > maxWidth && line) {
      lines.push(line.trim());
      line = `${word} `;
    } else line = test;
  });
  lines.push(line.trim());
  return lines;
}

function createPageCanvas(image: HTMLImageElement | null, spread: Spread, side: "left" | "right") {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1264;
  const context = canvas.getContext("2d");
  if (!context) return canvas;

  if (image) {
    const sourceX = side === "left" ? 0 : image.naturalWidth / 2;
    context.drawImage(image, sourceX, 0, image.naturalWidth / 2, image.naturalHeight, 0, 0, canvas.width, canvas.height);
  } else {
    // Typographic plate: warm uncoated paper, no illustration, so the real
    // three-dimensional centrepiece carries the spread.
    const wash = context.createLinearGradient(0, 0, side === "left" ? canvas.width : 0, canvas.height);
    wash.addColorStop(0, "#fbf5e7");
    wash.addColorStop(1, "#f0e6d1");
    context.fillStyle = wash;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (side === "left") {
    const darkSpread = spread.id === "lantern-garden";
    context.save();
    context.fillStyle = darkSpread ? "rgba(244, 232, 203, .95)" : "rgba(18, 20, 18, .96)";
    context.textBaseline = "top";
    let top = darkSpread ? 268 : 190;

    if (spread.kicker) {
      context.font = "28px Avenir Next, Arial, sans-serif";
      context.globalAlpha = 0.62;
      context.fillText(spread.kicker.toUpperCase(), 112, top - 66);
      context.globalAlpha = 1;
    }

    context.font = `${darkSpread ? 72 : 76}px Georgia, serif`;
    const titleLines = wrapText(context, spread.title, 560);
    titleLines.forEach((titleLine, index) => context.fillText(titleLine, 112, top + index * 84));
    context.font = "31px Avenir Next, Arial, sans-serif";
    context.globalAlpha = 0.88;
    top = top + titleLines.length * 86 + 40;
    wrapText(context, spread.body, 470).forEach((bodyLine, index) => context.fillText(bodyLine, 116, top + index * 45));

    if (!spread.textureUrl) {
      const rule = top + wrapText(context, spread.body, 470).length * 45 + 46;
      context.globalAlpha = 0.16;
      context.fillRect(116, rule, 300, 2);
      context.globalAlpha = 0.6;
      context.font = "26px Avenir Next, Arial, sans-serif";
      context.fillText("Interactive plate", 116, rule + 26);
    }
    context.restore();
  }
  return canvas;
}

async function loadPagePairs(spreads: Spread[]) {
  const entries = await Promise.all(
    spreads.map(async (spread) => {
      let image: HTMLImageElement | null = null;
      if (spread.textureUrl) {
        image = new Image();
        image.decoding = "async";
        image.src = spread.textureUrl;
        await image.decode();
      }
      const leftCanvas = createPageCanvas(image, spread, "left");
      const rightCanvas = createPageCanvas(image, spread, "right");
      const flipCanvas = (source: HTMLCanvasElement) => {
        const canvas = document.createElement("canvas");
        canvas.width = source.width;
        canvas.height = source.height;
        const context = canvas.getContext("2d");
        if (context) {
          context.translate(canvas.width, 0);
          context.scale(-1, 1);
          context.drawImage(source, 0, 0);
        }
        return canvas;
      };
      const left = new THREE.CanvasTexture(leftCanvas);
      const right = new THREE.CanvasTexture(rightCanvas);
      const leftBack = new THREE.CanvasTexture(flipCanvas(leftCanvas));
      const rightBack = new THREE.CanvasTexture(flipCanvas(rightCanvas));
      [left, right, leftBack, rightBack].forEach((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 8;
        texture.needsUpdate = true;
      });
      return [spread.id, { left, right, leftBack, rightBack }] as const;
    }),
  );
  return new Map<string, PagePair>(entries);
}

function makePageMaterial(side: THREE.Side) {
  return new THREE.MeshStandardMaterial({
    color: 0xfffbef,
    roughness: 0.82,
    metalness: 0,
    side,
    polygonOffset: true,
    polygonOffsetFactor: side === THREE.FrontSide ? -1 : 1,
    polygonOffsetUnits: 1,
  });
}

function makeOpenPageGeometry(side: "left" | "right") {
  const geometry = new THREE.PlaneGeometry(PAGE_W, PAGE_H, 40, 8);
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const normalized = (x + PAGE_W / 2) / PAGE_W;
    const distanceFromSpine = side === "left" ? 1 - normalized : normalized;
    const arch = Math.sin(Math.PI * distanceFromSpine) * 0.17;
    const outerLift = Math.pow(distanceFromSpine, 5) * 0.055;
    const cornerLift = Math.pow(Math.abs(y) / (PAGE_H / 2), 7) * 0.025;
    positions.setZ(index, arch + outerLift + cornerLift);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * One renderable scene element. The renderer knows nothing about specific
 * elements: hover, focus and reveal all come from the structured interaction
 * schema attached to the document data.
 */
type SceneElement = {
  id: string;
  root: THREE.Group;
  /** Leans a pop-up out of the page; unused by flat cutouts. */
  tilt: THREE.Group;
  /** Carries hover lean and focus orbit. */
  yaw: THREE.Group;
  /** Where the HTML reveal card anchors. */
  anchor: THREE.Object3D;
  materials: THREE.MeshStandardMaterial[];
  model: LandmarkModel | null;
  hoverAmount: number;
  focusAmount: number;
  spin: number;
  motionKey: string | null;
  motionStartedAt: number;
  dispose: () => void;
};

function buildSceneElement(element: BookElement, textureLoader: THREE.TextureLoader, resolvedAssetUrl = element.assetId): SceneElement {
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  const yaw = new THREE.Group();
  root.add(tilt);
  tilt.add(yaw);
  root.userData.elementId = element.id;
  root.visible = false;

  const anchor = new THREE.Object3D();
  root.add(anchor);

  if (element.modelId) {
    const model = element.modelId === "volcano-cross-section"
      ? createVolcanoCrossSection()
      : element.modelId === "great-pyramid"
        ? createGreatPyramid()
        : createFlavianAmphitheatre();
    model.group.scale.setScalar(0.78);
    yaw.add(model.group);
    tilt.rotation.x = POPUP_TILT;
    anchor.position.set(0, 1.34, 0.05);
    return {
      id: element.id,
      root,
      tilt,
      yaw,
      anchor,
      materials: model.emissiveMaterials,
      model,
      hoverAmount: 0,
      focusAmount: 0,
      spin: 0,
      motionKey: null,
      motionStartedAt: 0,
      dispose: () => model.dispose(),
    };
  }

  const texture = textureLoader.load(resolvedAssetUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.04,
    roughness: 0.75,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(0xffb570),
    emissiveIntensity: 0,
  });
  const size = element.id === "fox" ? 2 : 1.75;
  const geometry = new THREE.PlaneGeometry(size, size);
  const mesh = new THREE.Mesh(geometry, material);
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
    model: null,
    hoverAmount: 0,
    focusAmount: 0,
    spin: 0,
    motionKey: null,
    motionStartedAt: 0,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

export const ThreeBook = forwardRef<BookSceneHandle, Props>(function ThreeBook(
  { snapshot, turn, onSelect, onHover, onMoveElement, onPageGesture, onFailure },
  forwardedRef,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ snapshot, turn, onSelect, onHover, onMoveElement, onPageGesture, onFailure });
  propsRef.current = { snapshot, turn, onSelect, onHover, onMoveElement, onPageGesture, onFailure };
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneStructureKey = JSON.stringify({
    id: snapshot.document.id,
    spreads: snapshot.document.spreads.map((spread) => ({
      id: spread.id,
      title: spread.title,
      body: spread.body,
      kicker: spread.kicker,
      textureUrl: spread.textureUrl,
      elements: spread.elements.map((element) => [element.id, element.modelId]),
    })),
  });

  useImperativeHandle(forwardedRef, () => ({ canvas: canvasRef.current }), []);

  useEffect(() => {
    const maybeHost = hostRef.current;
    if (!maybeHost) return undefined;
    const host: HTMLDivElement = maybeHost;

    const scene = new THREE.Scene();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      recordDiagnostic("webgl:initialization-failed");
      propsRef.current.onFailure();
      return undefined;
    }
    recordDiagnostic("webgl:initialized", {
      quality: propsRef.current.snapshot.session.quality,
      pixelRatio: Math.min(window.devicePixelRatio, 1.5),
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.03;
    renderer.domElement.setAttribute("aria-label", "Interactive three-dimensional Apertale book");
    const onContextLost = (event: Event) => {
      event.preventDefault();
      recordDiagnostic("webgl:context-lost");
      propsRef.current.onFailure();
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    renderer.domElement.tabIndex = 0;
    host.appendChild(renderer.domElement);
    canvasRef.current = renderer.domElement;

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, -2.25, 12.05);
    camera.lookAt(0, -0.08, 0);

    const ambient = new THREE.HemisphereLight(0xfff4dc, 0x675b4b, 1.7);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffe9c6, 3.6);
    key.position.set(-3.5, 5.5, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -7;
    key.shadow.camera.right = 7;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -6;
    scene.add(key);
    const rim = new THREE.PointLight(0x91b8cf, 0.6, 18);
    rim.position.set(4, 1, 5);
    scene.add(rim);

    // Interaction light: driven entirely by the focus response of the element
    // that currently holds focus.
    const focusLight = new THREE.SpotLight(0xffd7a1, 0, 14, Math.PI / 7, 0.55, 1.4);
    focusLight.position.set(0, 3.4, 5.4);
    const focusTarget = new THREE.Object3D();
    scene.add(focusLight, focusTarget);
    focusLight.target = focusTarget;

    const book = new THREE.Group();
    book.rotation.x = -0.035;
    book.rotation.z = -0.006;
    book.position.y = 0.25;
    scene.add(book);

    const coverMaterial = new THREE.MeshStandardMaterial({ color: 0x173f39, roughness: 0.52, metalness: 0.03 });
    const cover = new THREE.Mesh(new THREE.BoxGeometry(9.05, 5.75, 0.22, 2, 2, 1), coverMaterial);
    cover.position.z = -0.25;
    cover.castShadow = true;
    cover.receiveShadow = true;
    book.add(cover);

    const pageBlockMaterial = new THREE.MeshStandardMaterial({ color: 0xe8dcc4, roughness: 0.92 });
    const leftStack = new THREE.Mesh(new THREE.BoxGeometry(4.32, 5.32, 0.34), pageBlockMaterial);
    const rightStack = leftStack.clone();
    leftStack.position.set(-2.16, 0, -0.13);
    rightStack.position.set(2.16, 0, -0.13);
    leftStack.castShadow = rightStack.castShadow = true;
    leftStack.receiveShadow = rightStack.receiveShadow = true;
    book.add(leftStack, rightStack);

    const leftMaterial = makePageMaterial(THREE.FrontSide);
    const rightMaterial = makePageMaterial(THREE.FrontSide);
    const leftGeometry = makeOpenPageGeometry("left");
    const rightGeometry = makeOpenPageGeometry("right");
    const leftPage = new THREE.Mesh(leftGeometry, leftMaterial);
    const rightPage = new THREE.Mesh(rightGeometry, rightMaterial);
    leftPage.position.set(-PAGE_W / 2, 0, 0.075);
    rightPage.position.set(PAGE_W / 2, 0, 0.08);
    leftPage.receiveShadow = rightPage.receiveShadow = true;
    book.add(leftPage, rightPage);

    const turnGeometry = new THREE.PlaneGeometry(PAGE_W, PAGE_H, 40, 4);
    const basePositions = Float32Array.from(turnGeometry.attributes.position.array as ArrayLike<number>);
    const turnFrontMaterial = makePageMaterial(THREE.FrontSide);
    const turnBackMaterial = makePageMaterial(THREE.BackSide);
    const turnFront = new THREE.Mesh(turnGeometry, turnFrontMaterial);
    const turnBack = new THREE.Mesh(turnGeometry, turnBackMaterial);
    turnFront.position.set(PAGE_W / 2, 0, 0.13);
    turnBack.position.copy(turnFront.position);
    turnFront.castShadow = turnBack.castShadow = true;
    turnFront.receiveShadow = turnBack.receiveShadow = true;
    turnFront.visible = turnBack.visible = false;
    book.add(turnFront, turnBack);

    const spine = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 5.22, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x5e5040, roughness: 0.78 }),
    );
    spine.position.z = -0.04;
    spine.castShadow = true;
    book.add(spine);

    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 7),
      new THREE.ShadowMaterial({ color: 0x130d08, opacity: 0.22 }),
    );
    shadowPlane.position.z = -0.39;
    shadowPlane.receiveShadow = true;
    book.add(shadowPlane);

    const textureLoader = new THREE.TextureLoader();
    const sceneElements = new Map<string, SceneElement>();
    const pendingAssets = new Set<string>();
    let disposed = false;
    const mountSceneElement = (element: BookElement) => {
      if (sceneElements.has(element.id) || pendingAssets.has(element.id)) return;
      if (!isStoredAssetId(element.assetId) || element.modelId) {
        const sceneElement = buildSceneElement(element, textureLoader);
        book.add(sceneElement.root);
        sceneElements.set(element.id, sceneElement);
        return;
      }
      pendingAssets.add(element.id);
      resolveAssetUrl(element.assetId).then((assetUrl) => {
        pendingAssets.delete(element.id);
        if (disposed || sceneElements.has(element.id)) return;
        const stillExists = propsRef.current.snapshot.document.spreads.some((spread) => spread.elements.some((item) => item.id === element.id));
        if (!stillExists) return;
        const sceneElement = buildSceneElement(element, textureLoader, assetUrl);
        book.add(sceneElement.root);
        sceneElements.set(element.id, sceneElement);
      }).catch(() => {
        pendingAssets.delete(element.id);
        recordDiagnostic("asset:resolve-failed", { elementId: element.id });
      });
    };
    propsRef.current.snapshot.document.spreads.forEach((spread) => {
      spread.elements.forEach(mountSceneElement);
    });

    const particleCount = 42;
    const particlePositions = new Float32Array(particleCount * 3);
    for (let index = 0; index < particleCount; index += 1) {
      particlePositions[index * 3] = (Math.random() - 0.5) * 9;
      particlePositions[index * 3 + 1] = (Math.random() - 0.35) * 5.5;
      particlePositions[index * 3 + 2] = 0.7 + Math.random() * 1.5;
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particleMaterial = new THREE.PointsMaterial({ color: 0xffd47c, size: 0.035, transparent: true, opacity: 0 });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    book.add(particles);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const drag = { elementId: null as string | null, startX: 0, startY: 0, initialX: 0, initialY: 0, moved: false, pageDirection: null as "forward" | "backward" | null, amount: 0 };
    let hoveredId: string | null = null;

    let pagePairs = new Map<string, PagePair>();
    loadPagePairs(propsRef.current.snapshot.document.spreads).then((pairs) => {
      if (disposed) {
        pairs.forEach(({ left, right, leftBack, rightBack }) => {
          left.dispose(); right.dispose(); leftBack.dispose(); rightBack.dispose();
        });
      } else pagePairs = pairs;
    });

    function resize() {
      const width = host.clientWidth;
      const height = host.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const horizontalFit = 9.7 / (2 * Math.tan(verticalFov / 2) * camera.aspect);
      camera.position.z = Math.max(12.05, horizontalFit);
      camera.position.y = camera.position.z * -0.18;
      camera.lookAt(0, camera.aspect < 0.65 ? -1.75 : -0.08, 0);
      camera.updateProjectionMatrix();
    }
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    function setPointer(event: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      return rect;
    }

    function currentSpread() {
      const current = propsRef.current.snapshot;
      return current.document.spreads[current.session.currentSpreadIndex];
    }

    function pickElement() {
      raycaster.setFromCamera(pointer, camera);
      const roots = currentSpread()
        .elements.map((element) => sceneElements.get(element.id))
        .filter((item): item is SceneElement => Boolean(item) && Boolean(item?.root.visible))
        .map((item) => item.root);
      const hit = raycaster.intersectObjects(roots, true)[0];
      if (!hit) return null;
      let node: THREE.Object3D | null = hit.object;
      while (node && !node.userData.elementId) node = node.parent;
      return node ? String(node.userData.elementId) : null;
    }

    function setHovered(elementId: string | null) {
      if (hoveredId === elementId) return;
      hoveredId = elementId;
      renderer.domElement.style.cursor = elementId ? "pointer" : "";
      propsRef.current.onHover(elementId);
    }

    function onPointerDown(event: PointerEvent) {
      const rect = setPointer(event);
      const elementId = pickElement();
      if (elementId) {
        const element = currentSpread().elements.find((item) => item.id === elementId);
        propsRef.current.onSelect(elementId);
        if (element && !element.locked) {
          drag.elementId = elementId;
          drag.startX = event.clientX;
          drag.startY = event.clientY;
          drag.initialX = element.transform.x;
          drag.initialY = element.transform.y;
          drag.moved = false;
          renderer.domElement.setPointerCapture(event.pointerId);
        }
        return;
      }
      const x = (event.clientX - rect.left) / rect.width;
      const index = propsRef.current.snapshot.session.currentSpreadIndex;
      const count = propsRef.current.snapshot.document.spreads.length;
      if (x > 0.74 && index < count - 1) drag.pageDirection = "forward";
      else if (x < 0.26 && index > 0) drag.pageDirection = "backward";
      if (drag.pageDirection) {
        drag.startX = event.clientX;
        drag.amount = 0;
        propsRef.current.onPageGesture(drag.pageDirection, "start", 0);
        renderer.domElement.setPointerCapture(event.pointerId);
      } else propsRef.current.onSelect(null);
    }

    function onPointerMove(event: PointerEvent) {
      setPointer(event);
      if (drag.elementId) {
        const rect = renderer.domElement.getBoundingClientRect();
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 2) drag.moved = true;
        const nextX = clamp(drag.initialX + (event.clientX - drag.startX) / (rect.width * 0.5));
        const nextY = clamp(drag.initialY + (event.clientY - drag.startY) / (rect.height * 0.72));
        const sceneElement = sceneElements.get(drag.elementId);
        const element = currentSpread().elements.find((item) => item.id === drag.elementId);
        if (sceneElement && element) {
          const pageX = element.page === "right" ? PAGE_W / 2 : -PAGE_W / 2;
          sceneElement.root.position.x = pageX + (nextX - 0.5) * PAGE_W;
          sceneElement.root.position.y = (0.5 - nextY) * PAGE_H;
        }
        return;
      }
      if (drag.pageDirection) {
        const rect = renderer.domElement.getBoundingClientRect();
        const delta = drag.pageDirection === "forward" ? drag.startX - event.clientX : event.clientX - drag.startX;
        drag.amount = clamp(delta / (rect.width * 0.42));
        propsRef.current.onPageGesture(drag.pageDirection, "move", drag.amount);
        return;
      }
      setHovered(propsRef.current.turn ? null : pickElement());
    }

    function onPointerUp(event: PointerEvent) {
      if (drag.elementId) {
        const rect = renderer.domElement.getBoundingClientRect();
        const nextX = clamp(drag.initialX + (event.clientX - drag.startX) / (rect.width * 0.5));
        const nextY = clamp(drag.initialY + (event.clientY - drag.startY) / (rect.height * 0.72));
        if (drag.moved) propsRef.current.onMoveElement(drag.elementId, nextX, nextY);
        drag.elementId = null;
        drag.moved = false;
      }
      if (drag.pageDirection) {
        propsRef.current.onPageGesture(drag.pageDirection, "end", drag.amount);
        drag.pageDirection = null;
        drag.amount = 0;
      }
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    }

    function onPointerLeave() {
      setHovered(null);
    }

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);

    const anchorWorld = new THREE.Vector3();
    let lastFrameTime = performance.now();
    let frame = 0;
    let raf = 0;
    let lastSpreadId = "";

    function updateTurn(progress: number) {
      const positions = turnGeometry.attributes.position as THREE.BufferAttribute;
      for (let index = 0; index < positions.count; index += 1) {
        const baseIndex = index * 3;
        const x = basePositions[baseIndex];
        const y = basePositions[baseIndex + 1];
        const deformed = deformPageVertex(x, y, progress, PAGE_W);
        positions.setXYZ(index, deformed.x, deformed.y, deformed.z);
      }
      positions.needsUpdate = true;
      turnGeometry.computeVertexNormals();
      turnGeometry.computeBoundingBox();
      turnGeometry.computeBoundingSphere();
    }

    function animate() {
      raf = requestAnimationFrame(animate);
      const { snapshot: current, turn: currentTurn } = propsRef.current;
      const spread = current.document.spreads[current.session.currentSpreadIndex];
      const pagePair = pagePairs.get(spread.id);
      if (pagePair && !currentTurn && (spread.id !== lastSpreadId || leftMaterial.map !== pagePair.left || rightMaterial.map !== pagePair.right)) {
        leftMaterial.map = pagePair.left;
        rightMaterial.map = pagePair.right;
        leftMaterial.needsUpdate = rightMaterial.needsUpdate = true;
        lastSpreadId = spread.id;
      }

      const night = current.session.sceneThemeId === "midnight-desk";
      const reduced = current.session.quality === "reduced";
      const frameTime = performance.now();
      const deltaSeconds = Math.min(0.05, (frameTime - lastFrameTime) / 1000);
      const delta = clamp(deltaSeconds * 4, 0, 1);
      lastFrameTime = frameTime;
      ambient.intensity = THREE.MathUtils.lerp(ambient.intensity, night ? 0.48 : 1.7, delta);
      key.intensity = THREE.MathUtils.lerp(key.intensity, night ? 2.45 : 3.6, delta);
      key.color.lerp(new THREE.Color(night ? 0xffb86b : 0xffe9c6), delta);
      rim.intensity = THREE.MathUtils.lerp(rim.intensity, night ? 1.85 : 0.6, delta);
      coverMaterial.color.lerp(new THREE.Color(night ? 0x261912 : 0x173f39), delta);
      particleMaterial.opacity = THREE.MathUtils.lerp(particleMaterial.opacity, night && !reduced ? 0.72 : 0, delta);
      particles.rotation.z += night && !reduced ? 0.00025 : 0;
      renderer.toneMappingExposure = THREE.MathUtils.lerp(renderer.toneMappingExposure, night ? 0.82 : 1.03, delta);

      if (currentTurn) {
        turnFront.visible = turnBack.visible = true;
        const nextIndex = currentTurn.direction === "forward" ? current.session.currentSpreadIndex + 1 : current.session.currentSpreadIndex - 1;
        const nextSpread = current.document.spreads[nextIndex];
        const nextPair = nextSpread ? pagePairs.get(nextSpread.id) : null;
        if (currentTurn.direction === "forward") {
          turnFrontMaterial.map = pagePair?.right ?? null;
          turnBackMaterial.map = nextPair?.leftBack ?? null;
          if (nextPair && rightMaterial.map !== nextPair.right) {
            rightMaterial.map = nextPair.right;
            rightMaterial.needsUpdate = true;
          }
          rightPage.visible = leftPage.visible = true;
        } else {
          turnFrontMaterial.map = nextPair?.right ?? null;
          turnBackMaterial.map = pagePair?.leftBack ?? null;
          if (nextPair && leftMaterial.map !== nextPair.left) {
            leftMaterial.map = nextPair.left;
            leftMaterial.needsUpdate = true;
          }
          leftPage.visible = rightPage.visible = true;
        }
        turnFrontMaterial.needsUpdate = turnBackMaterial.needsUpdate = true;
        updateTurn(currentTurn.progress);
      } else {
        turnFront.visible = turnBack.visible = false;
        leftPage.visible = rightPage.visible = true;
      }

      const time = frameTime;
      let focusIntensity = 0;
      spread.elements.forEach((element) => {
        mountSceneElement(element);
      });
      sceneElements.forEach((sceneElement, id) => {
        const element = spread.elements.find((item) => item.id === id);
        sceneElement.root.visible = Boolean(element) && !currentTurn;
        if (!element || currentTurn) {
          sceneElement.hoverAmount = 0;
          sceneElement.focusAmount = 0;
          return;
        }

        const interaction = resolveInteraction(element);
        const hover = hoverTraits(interaction.hover);
        const focus = focusTraits(interaction.focus);
        const hovered = hoveredId === id && !current.session.preview;
        const focused = current.session.selectionId === id;
        sceneElement.hoverAmount = THREE.MathUtils.lerp(sceneElement.hoverAmount, hovered ? 1 : 0, clamp(deltaSeconds * 7, 0, 1));
        sceneElement.focusAmount = THREE.MathUtils.lerp(sceneElement.focusAmount, focused ? 1 : 0, clamp(deltaSeconds * 5, 0, 1));

        const pageCenter = element.page === "right" ? PAGE_W / 2 : -PAGE_W / 2;
        let x = pageCenter + (element.transform.x - 0.5) * PAGE_W;
        let y = (0.5 - element.transform.y) * PAGE_H;
        let scale = element.transform.scaleX;
        if (element.motion && !reduced) {
          const motionKey = `${element.motion.preset}:${element.motion.durationMs}:${element.motion.loop}`;
          if (sceneElement.motionKey !== motionKey) {
            sceneElement.motionKey = motionKey;
            sceneElement.motionStartedAt = time;
          }
          const motion = motionTraits(element.motion, time - sceneElement.motionStartedAt);
          x += motion.x;
          y += motion.y;
          scale *= motion.scale;
        } else {
          sceneElement.motionKey = null;
          sceneElement.motionStartedAt = time;
        }

        const rise = hover.rise * sceneElement.hoverAmount + focus.rise * sceneElement.focusAmount;
        // Focused elements slide toward the spine so the reveal card, which
        // opens on the outer margin, never covers the object it describes.
        const focusClearance = host.clientWidth <= 880 ? 0 : focus.shift * (host.clientWidth < 1100 ? 1.75 : 1);
        x += (element.page === "right" ? -1 : 1) * focusClearance * sceneElement.focusAmount;
        const interactionScale =
          1 + (hover.scale - 1) * sceneElement.hoverAmount + (focus.scale - 1) * sceneElement.focusAmount;
        sceneElement.root.position.set(x, y, 0.39 + element.depth + rise);
        sceneElement.root.rotation.z = THREE.MathUtils.degToRad(-element.transform.rotationDeg);
        const appliedScale = scale * interactionScale;
        sceneElement.root.scale.set(appliedScale, element.transform.scaleY * (appliedScale / element.transform.scaleX), appliedScale);

        // Hover lean follows the live pointer; focus orbit is a named response.
        const leanTarget = hovered && !reduced ? pointer.x * hover.tilt * 2.4 : 0;
        const pitchTarget = hovered && !reduced ? -pointer.y * hover.tilt : 0;
        const spinDelta = focused && !reduced ? focus.spin * deltaSeconds : 0;
        sceneElement.spin += spinDelta;
        sceneElement.yaw.rotation.y = THREE.MathUtils.lerp(sceneElement.yaw.rotation.y, sceneElement.spin + leanTarget, clamp(deltaSeconds * 6, 0, 1));
        if (sceneElement.model) {
          sceneElement.tilt.rotation.x = THREE.MathUtils.lerp(sceneElement.tilt.rotation.x, POPUP_TILT + pitchTarget, clamp(deltaSeconds * 6, 0, 1));
          const breathe = reduced ? 0 : Math.sin(time / 2600) * 0.012;
          sceneElement.tilt.position.y = THREE.MathUtils.lerp(sceneElement.tilt.position.y, breathe, clamp(deltaSeconds * 3, 0, 1));
          sceneElement.model.applyNight(night ? 1 : 0);
        }

        const glow = hover.emissive * sceneElement.hoverAmount + 0.1 * sceneElement.focusAmount;
        sceneElement.materials.forEach((material) => {
          material.emissiveIntensity = glow;
        });

        if (focused) {
          focusIntensity = Math.max(focusIntensity, focus.spotlight * sceneElement.focusAmount);
          sceneElement.anchor.getWorldPosition(anchorWorld);
          focusTarget.position.copy(anchorWorld);
          focusLight.position.set(anchorWorld.x - 0.6, anchorWorld.y + 3.1, anchorWorld.z + 4.6);
          anchorWorld.project(camera);
          const screenX = (anchorWorld.x * 0.5 + 0.5) * host.clientWidth;
          const screenY = (-anchorWorld.y * 0.5 + 0.5) * host.clientHeight;
          host.parentElement?.style.setProperty("--selection-x", `${screenX}px`);
          host.parentElement?.style.setProperty("--selection-y", `${screenY}px`);
        }
      });
      focusLight.intensity = THREE.MathUtils.lerp(focusLight.intensity, focusIntensity, delta);

      frame += 1;
      if (frame % 60 === 0) renderer.info.reset();
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      pagePairs.forEach(({ left, right, leftBack, rightBack }) => {
        left.dispose(); right.dispose(); leftBack.dispose(); rightBack.dispose();
      });
      sceneElements.forEach((sceneElement) => sceneElement.dispose());
      leftGeometry.dispose();
      rightGeometry.dispose();
      turnGeometry.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      canvasRef.current = null;
      recordDiagnostic("webgl:disposed");
    };
  }, [sceneStructureKey]);

  return <div className="book-scene" ref={hostRef} />;
});
