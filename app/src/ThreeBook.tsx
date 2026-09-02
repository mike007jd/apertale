import { useEffect, useRef } from "react";
import * as THREE from "three";
import { acquireAssetUrl, acquireAssetUrls, isStoredAssetId, type AssetUrlLease } from "./assetStore";
import { clamp01, smootherstep } from "./design/curves";
import { recordDiagnostic } from "./diagnostics";
import { coverBoardMaterials, createCoverEndpaperCanvas, paintCoverEndpaper } from "./endpaper";
import { BOARD_H, BOARD_T, BOARD_W, BODY_BASE, JOINT, PAGE_H, PAGE_THICKNESS, PAGE_W, buildSceneElement, createTurnLeaf, makeOpenPageGeometry, makePageMaterial, type SceneElement } from "./bookGeometry";
import { createBookPointer, type BookPointerProps } from "./bookPointer";
import { MARK_REVEAL_MS, MAX_REVEAL_MS, getSketchImageVersion, loadPagePairs, paintSketchFade, paintWorkshopDrawing, snapshotOverlay, type PagePair } from "./pageCanvas";
import { readerCameraPage, readerSinglePagePresentation, spreadFraction } from "./stageGeometry";
import { focusTraits, frameSequenceIndex, hoverTraits, motionTraits, resolveInteraction } from "./interaction";
import { bookCaseMatterPose, bookSpinePose, caseHandoffGroupX, resolveTurnContentPlan } from "./pageDeformation";
import { readerSceneStructureKey, resourceAttemptIsCurrent, sceneAssetsReadyForEvidence, spreadResourceIndexes, type ReaderRenderEvidence } from "./renderEvidence";
import type { StoryboardSpread } from "./storyboard";
import { renderedElementAssetIds, type BookElement, type Spread } from "./types";

type Props = Omit<BookPointerProps, "annotationEnabled" | "readOnly"> & {
  renderEvidenceToken?: string;
  mode?: "reader" | "workshop";
  workshopDrawing?: { revision: number; spread?: StoryboardSpread };
  annotationEnabled?: boolean;
  readOnly?: boolean;
  /**
   * 1 is fully open, 0 is closed with the cover facing the reader. The caller
   * owns the timing; the renderer only follows, so open and close share one
   * code path and the pose stays duration-agnostic.
   *
   * A ref rather than a value on purpose. Driving this through React state
   * re-rendered the whole app on every animation frame and stretched one
   * navigation interval to over a second; the render loop reads the current
   * value itself while the stage is visible.
   */
  openProgress?: { readonly current: number };
  /**
   * Where this book sits on the shelf, in viewport CSS pixels, or null
   * when there is no slot to travel from. The renderer unprojects it so the
   * case starts the open in the slot the reader clicked and lands back in it
   * on the way home.
   */
  handoffRect?: { readonly current: ShelfSlot | null };
  onPageTurnReady?: (direction: "forward" | "backward", ready: boolean) => void;
  onLoading: (documentId: string) => void;
  onReady: (documentId: string) => void;
  onRendered?: (evidence: ReaderRenderEvidence & { surface: "webgl" }) => void;
  onFailure: (sceneKey: string) => void;
};

/** The shelf card a book is being lifted out of, in viewport pixels. */
type ShelfSlot = { x: number; y: number; width: number; height: number };


/** Surfaces that never animate the case hold it fully open. */
const STATIC_OPEN = { current: 1 } as const;
/** Surfaces with no shelf behind them open in place. */
const NO_HANDOFF = { current: null } as const;

export function ThreeBook({ snapshot, turn, renderEvidenceToken, mode = "reader", workshopDrawing, annotationEnabled = false, readOnly = false, openProgress = STATIC_OPEN, handoffRect = NO_HANDOFF, onSelect, onHover, onMoveElement, onPageGesture, onAnnotationStroke, onPageTurnReady, onLoading, onReady, onRendered, onFailure }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ snapshot, turn, renderEvidenceToken, mode, workshopDrawing, annotationEnabled, readOnly, openProgress, handoffRect, onSelect, onHover, onMoveElement, onPageGesture, onAnnotationStroke, onPageTurnReady, onLoading, onReady, onRendered, onFailure });
  propsRef.current = { snapshot, turn, renderEvidenceToken, mode, workshopDrawing, annotationEnabled, readOnly, openProgress, handoffRect, onSelect, onHover, onMoveElement, onPageGesture, onAnnotationStroke, onPageTurnReady, onLoading, onReady, onRendered, onFailure };
  const sceneStructureKey = readerSceneStructureKey(snapshot, mode);

  useEffect(() => {
    const maybeHost = hostRef.current;
    if (!maybeHost) return undefined;
    const host: HTMLDivElement = maybeHost;
    const loadingDocumentId = propsRef.current.snapshot.document.id;
    const failureSceneKey = sceneStructureKey;
    const reportFailure = () => propsRef.current.onFailure(failureSceneKey);
    propsRef.current.onLoading(loadingDocumentId);

    const scene = new THREE.Scene();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      recordDiagnostic("webgl:initialization-failed");
      reportFailure();
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
    renderer.domElement.setAttribute("aria-label", mode === "workshop" ? "Blank Apertale book canvas" : "Interactive Apertale picture book");
    const onContextLost = (event: Event) => {
      event.preventDefault();
      recordDiagnostic("webgl:context-lost");
      reportFailure();
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    renderer.domElement.tabIndex = 0;
    host.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, -2.25, 12.05);
    camera.lookAt(0, -0.08, 0);

    // Every spread owns one illustrated coordinate system spanning both pages.
    // It is rendered offscreen and the physical paper samples the left/right
    // half of the same texture, including its interactive cut-paper layers.
    const stageScene = new THREE.Scene();
    const stageFlatScene = new THREE.Scene();
    // One projection, not two. A three.js camera is not owned by a scene, and
    // these were built with the same frustum, placed at the same point, never
    // rotated and re-projected together in a single loop - so "keep these two
    // identical" was a standing invariant a reader had to check eight sites to
    // discover was never violated.
    const stageCamera = new THREE.OrthographicCamera(-PAGE_W, PAGE_W, PAGE_H / 2, -PAGE_H / 2, 0.1, 30);
    stageCamera.position.set(0, 0, 12);
    const stageBackgroundMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const stageBackgroundGeometry = new THREE.PlaneGeometry(PAGE_W * 2, PAGE_H);
    const stageBackground = new THREE.Mesh(stageBackgroundGeometry, stageBackgroundMaterial);
    stageBackground.position.z = -1.2;
    stageFlatScene.add(stageBackground);
    const stageOverlayMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const stageOverlayGeometry = new THREE.PlaneGeometry(PAGE_W * 2, PAGE_H);
    const stageOverlay = new THREE.Mesh(stageOverlayGeometry, stageOverlayMaterial);
    stageOverlay.position.z = 8;
    stageOverlay.renderOrder = 100;
    stageFlatScene.add(stageOverlay);

    const makeSpreadTarget = () => {
      const target = new THREE.WebGLRenderTarget(1536, Math.round(1536 * PAGE_H / (PAGE_W * 2)), {
        depthBuffer: true,
        stencilBuffer: false,
      });
      target.samples = 2;
      target.texture.colorSpace = THREE.SRGBColorSpace;
      target.texture.minFilter = THREE.LinearFilter;
      target.texture.magFilter = THREE.LinearFilter;
      return target;
    };
    const liveSpreadTarget = makeSpreadTarget();
    const destinationSpreadTarget = makeSpreadTarget();

    const ambient = new THREE.HemisphereLight(0xfff4dc, 0x675b4b, 1.7);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffe9c6, 3.6);
    key.position.set(-3.5, 5.5, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    // Three r185's PCF path spreads its samples by this radius. Keep the
    // existing 1024 map and blur the penumbra instead of spending more GPU on
    // a larger target or selecting the deprecated PCFSoftShadowMap constant.
    key.shadow.radius = 4;
    key.shadow.camera.left = -7;
    key.shadow.camera.right = 7;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -6;
    scene.add(key);
    const rim = new THREE.PointLight(0x91b8cf, 0.6, 18);
    rim.position.set(4, 1, 5);
    scene.add(rim);
    const pageHalo = new THREE.PointLight(0xffa84f, 0, 9, 1.8);
    pageHalo.position.set(0.35, 0.4, 2.4);
    scene.add(pageHalo);
    // The night presentation is a dark room with a real, localised desk-lamp
    // pool over the open book—not a uniform dark filter over the artwork.
    const deskLampTarget = new THREE.Object3D();
    deskLampTarget.position.set(0.2, 0.05, 0.1);
    scene.add(deskLampTarget);
    const deskLamp = new THREE.SpotLight(0xffc77d, 0, 22, Math.PI / 4.15, 0.72, 1.1);
    deskLamp.position.set(-4.7, 5.5, 7.5);
    deskLamp.target = deskLampTarget;
    scene.add(deskLamp);

    const stageAmbient = new THREE.HemisphereLight(0xfff4dc, 0x675b4b, 1.9);
    const stageKey = new THREE.DirectionalLight(0xffe9c6, 4.2);
    stageKey.position.set(-4.6, 5.8, 8.5);
    const stageRim = new THREE.PointLight(0x91b8cf, 0.8, 20);
    stageRim.position.set(4.4, 1.4, 6.2);
    stageScene.add(stageAmbient, stageKey, stageRim);

    // Interaction light: driven entirely by the focus response of the element
    // that currently holds focus.
    const focusLight = new THREE.SpotLight(0xffd7a1, 0, 14, Math.PI / 7, 0.55, 1.4);
    focusLight.position.set(0, 3.4, 5.4);
    const focusTarget = new THREE.Object3D();
    stageScene.add(focusLight, focusTarget);
    focusLight.target = focusTarget;

    const book = new THREE.Group();
    book.rotation.x = -0.035;
    book.rotation.z = -0.006;
    book.position.y = 0.25;
    scene.add(book);

    // The case was one rigid slab spanning both boards and the spine, so
    // nothing could rotate and the book had no closed state at all. It is now
    // three parts: a spine shell that flexes between both hinges, a rear board
    // that never rotates, and a front board on a real joint.
    //
    // BOARD_W x 2 + spine reproduces the old 9.05 silhouette exactly for a
    // five-spread book, so the open pose - and everything framed against it -
    // is unchanged.
    const spineWidth = (spreadCount: number) =>
      (spreadCount + 1) * PAGE_THICKNESS + BODY_BASE + 2 * BOARD_T + 2 * JOINT;
    const textBlockDepth = (spreadCount: number) => (spreadCount + 1) * PAGE_THICKNESS + BODY_BASE;

    let spineGap = spineWidth(propsRef.current.snapshot.document.spreads.length);

    const coverMaterial = new THREE.MeshStandardMaterial({ color: 0x173f39, roughness: 0.52, metalness: 0.03 });
    const spineMaterial = new THREE.MeshStandardMaterial({ color: 0x5e5040, roughness: 0.78, side: THREE.DoubleSide });

    const spineShell = new THREE.Mesh(
      // Open-ended: the head and tail of a cased spine are covered by the
      // boards, so capping it only produces two half-discs that catch the key
      // light below the book.
      new THREE.CylinderGeometry(spineGap / 2, spineGap / 2, BOARD_H, 18, 1, true, Math.PI / 2, Math.PI),
      spineMaterial,
    );
    spineShell.position.set(0, 0, -(BOARD_T + 0.22) / 2);
    spineShell.castShadow = true;
    book.add(spineShell);

    const endpaperCanvas = createCoverEndpaperCanvas();
    const endpaperTexture = new THREE.CanvasTexture(endpaperCanvas);
    endpaperTexture.colorSpace = THREE.SRGBColorSpace;
    endpaperTexture.anisotropy = 4;
    const endpaperMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: endpaperTexture,
      roughness: 0.94,
      metalness: 0,
    });
    const coverFaceMaterial = new THREE.MeshStandardMaterial({
      color: 0x173f39,
      roughness: 0.58,
      metalness: 0.02,
    });
    const insideCoverMaterial = new THREE.MeshStandardMaterial({
      color: 0x173f39,
      roughness: 0.72,
      metalness: 0.01,
    });
    /**
     * Box faces run [+x, -x, +y, -y, +z, -z]. The printed front board owns
     * real mapped materials on both broad faces; the structural rear board
     * keeps the quieter pastedown treatment on its inner face.
     */
    const makeBoard = (printedFront = false) => {
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(BOARD_W, BOARD_H, BOARD_T, 1, 1, 1),
        printedFront
          ? coverBoardMaterials(coverMaterial, coverFaceMaterial, insideCoverMaterial)
          : coverBoardMaterials(coverMaterial, coverMaterial, endpaperMaterial),
      );
      board.castShadow = false;
      board.receiveShadow = true;
      return board;
    };

    // The rear board is structural: it is what the open spread rests on, and
    // it never rotates. Keeping it a sibling of the front board rather than a
    // child is what lets the front board swing without dragging it along.
    const rearBoardPivot = new THREE.Group();
    const rearBoard = makeBoard();
    rearBoard.position.x = BOARD_W / 2;
    rearBoardPivot.add(rearBoard);
    rearBoardPivot.position.set(spineGap / 2, 0, -(0.22 + BOARD_T) / 2);
    book.add(rearBoardPivot);

    /**
     * The front board's joint must translate as it rotates. A fixed-axis
     * rotation leaves the two boards misaligned by exactly the spine width at
     * closure, which reads as the cover floating off its own hinge.
     */
    const frontBoardPivot = new THREE.Group();
    const frontBoard = makeBoard(true);
    frontBoard.position.x = BOARD_W / 2;
    frontBoardPivot.add(frontBoard);
    book.add(frontBoardPivot);

    // The left page and its paper block are the front matter: they travel with
    // the front cover instead of remaining as a fully open spread underneath
    // it. This pivot uses the page's existing left-of-spine coordinates, so an
    // open pose is the identity transform and the settled reader stays exact.
    const frontMatterPivot = new THREE.Group();
    book.add(frontMatterPivot);

    /**
     * Covers are authored 2:3 while the board is 4.27 x 5.75, so the map is
     * cropped rather than stretched - 118px comes off the bottom of 1152 and
     * the title, which always sits in the upper half, survives intact.
     *
     * The map is assigned to the BoxGeometry's real outer face. A separate
     * coplanar plane disappeared at edge-on angles and exposed the plain board
     * underneath; binding the texture to the case makes it survive the entire
     * opening and closing arc. Readiness waits for this load, so a personal
     * IndexedDB cover cannot pop in halfway through the swing.
     */
    const coverSource = propsRef.current.snapshot.document.coverAssetId ?? propsRef.current.snapshot.document.coverTextureUrl;
    let coverReady = !coverSource;
    if (coverSource) {
      void acquireAssetUrl(coverSource).then(async (lease) => {
        try {
          const texture = await new Promise<THREE.Texture>((resolve, reject) => {
            textureLoader.load(lease.url, resolve, undefined, reject);
          });
          if (disposed) {
            texture.dispose();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = 8;
          const boardAspect = BOARD_W / BOARD_H;
          const image = texture.image as { width?: number; height?: number } | undefined;
          const artAspect = (image?.width ?? 2) / (image?.height ?? 3);
          if (artAspect < boardAspect) {
            texture.repeat.set(1, artAspect / boardAspect);
            texture.offset.set(0, (1 - artAspect / boardAspect) / 2);
          } else {
            texture.repeat.set(boardAspect / artAspect, 1);
            texture.offset.set((1 - boardAspect / artAspect) / 2, 0);
          }
          if (texture.image) {
            paintCoverEndpaper(endpaperCanvas, texture.image as CanvasImageSource);
            endpaperTexture.needsUpdate = true;
          }
          coverFaceMaterial.color.set(0xffffff);
          coverFaceMaterial.map = texture;
          coverFaceMaterial.needsUpdate = true;
          insideCoverMaterial.color.set(0xffffff);
          insideCoverMaterial.map = texture;
          insideCoverMaterial.needsUpdate = true;
          coverReady = true;
          reportReadyForCurrentSpread();
        } finally {
          lease.release();
        }
      })
        .catch(() => {
          coverReady = true;
          reportReadyForCurrentSpread();
          recordDiagnostic("asset:cover-board-failed", { documentId: propsRef.current.snapshot.document.id });
        });
    }

    /**
     * phi = 0 is fully open; phi = PI is closed with the spine on the left and
     * the cover art facing the reader.
     *
     * The pivot translates by the spine width as it rotates. A fixed-axis
     * rotation is the obvious implementation and it is wrong: it leaves the
     * two boards offset by exactly the spine at closure, so the cover appears
     * to float off its own hinge.
     */
    let coverPhi = 0;
    const bookRestY = book.position.y;
    const anchorPoint = new THREE.Vector3();

    /**
     * Turns the shelf card's screen rect into the world pose that places the
     * closed case there. The camera stays fixed, so the result is cached until
     * either the slot object changes or resize() invalidates the host geometry.
     * Returns null when there is no slot, in which case the case opens in place.
     */
    let anchorCacheKey: ShelfSlot | null | undefined;
    let anchorCache: { x: number; y: number; scale: number } | null = null;

    function shelfAnchor() {
      const rect = propsRef.current.handoffRect.current;
      if (rect === anchorCacheKey) return anchorCache;
      anchorCacheKey = rect;
      anchorCache = measureShelfAnchor(rect);
      return anchorCache;
    }

    function measureShelfAnchor(rect: ShelfSlot | null) {
      if (!rect) return null;
      const box = host.getBoundingClientRect();
      const width = box.width;
      const height = box.height;
      if (width < 2 || height < 2) return null;

      const ndcX = ((rect.x + rect.width / 2 - box.left) / width) * 2 - 1;
      const ndcY = -(((rect.y + rect.height / 2 - box.top) / height) * 2 - 1);
      camera.updateMatrixWorld();
      anchorPoint.set(ndcX, ndcY, 0.5).unproject(camera).sub(camera.position);
      // Walk the ray out to the plane the book stands on.
      if (Math.abs(anchorPoint.z) < 1e-6) return null;
      const travel = -camera.position.z / anchorPoint.z;
      const x = camera.position.x + anchorPoint.x * travel;
      const y = camera.position.y + anchorPoint.y * travel;

      const visibleHeight = 2 * Math.abs(camera.position.z) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const worldPerPixel = visibleHeight / height;
      return { x, y, scale: (rect.height * worldPerPixel) / BOARD_H };
    }
    const openBoardZ = -(0.22 + BOARD_T) / 2;

    /**
     * The board stops just shy of flat. A cover that lands has a moment of
     * contact, and a moment of contact is a thing that can pop; removing the
     * landing removes the problem rather than trying to cushion it.
     */
    const FLAT_PHI = 0.055;

    /** Openness to board angle. Written twice, once without FLAT_PHI. */
    const phiFor = (open: number) => FLAT_PHI + (1 - THREE.MathUtils.clamp(open, 0, 1)) * (Math.PI - FLAT_PHI);

    function applyCover() {
      const phi = coverPhi;
      const openness = 1 - THREE.MathUtils.clamp((phi - FLAT_PHI) / (Math.PI - FLAT_PHI), 0, 1);
      const matterPose = bookCaseMatterPose(openness, FLAT_PHI);
      const closure = matterPose.closure;
      frontBoardPivot.rotation.y = matterPose.coverY;
      frontBoardPivot.position.set(
        -(spineGap / 2) * Math.cos(phi),
        0,
        THREE.MathUtils.lerp(openBoardZ, textBlockDepth(propsRef.current.snapshot.document.spreads.length) / 2 + BOARD_T / 2, closure),
      );
      const spinePose = bookSpinePose(rearBoardPivot.position, frontBoardPivot.position, spineGap);
      spineShell.position.set(spinePose.x, 0, spinePose.z);
      spineShell.rotation.y = spinePose.rotationY;
      spineShell.scale.set(spinePose.scale, 1, spinePose.scale);
      frontMatterPivot.rotation.y = matterPose.foldY;
      frontMatterPivot.position.x = (spineGap / 2) * closure;
      leftPage.scale.z = rightPage.scale.z = matterPose.reliefZ;
    }

    const pageBlockMaterial = new THREE.MeshStandardMaterial({ color: 0xe8dcc4, roughness: 0.92 });
    // Unit depth, so the two stacks can be driven by scale as the reader moves
    // through the book. They used to be fixed at 0.34 each, which meant spread
    // one and spread twelve had identical thickness on both sides.
    const pageBlockGeometry = new THREE.BoxGeometry(PAGE_W, 5.32, 1);
    const leftStack = new THREE.Mesh(
      pageBlockGeometry,
      // This is the face that remains parallel to the outer board while the
      // front matter follows the opening case. If it uses plain paper it sits
      // in front of the real cover and reads as a missing texture. Reusing the
      // mapped cover face preserves one continuous printed case through the
      // handoff; once open, this face is underneath the left page.
      coverBoardMaterials(pageBlockMaterial, pageBlockMaterial, coverFaceMaterial),
    );
    const rightStack = new THREE.Mesh(pageBlockGeometry, pageBlockMaterial);
    /**
     * The block's FRONT face stays put at BLOCK_FRONT so the pages always rest
     * on top of it; only its back face moves as thickness shifts from one side
     * to the other. Growing the box about its centre instead would push paper
     * through the spread.
     */
    const BLOCK_FRONT = 0.04;
    const seatStack = (stack: THREE.Mesh, x: number, depth: number) => {
      stack.scale.z = Math.max(depth, 0.02);
      stack.position.set(x, 0, BLOCK_FRONT - stack.scale.z / 2);
    };
    seatStack(leftStack, -PAGE_W / 2, textBlockDepth(propsRef.current.snapshot.document.spreads.length) / 2);
    seatStack(rightStack, PAGE_W / 2, textBlockDepth(propsRef.current.snapshot.document.spreads.length) / 2);
    leftStack.castShadow = rightStack.castShadow = true;
    leftStack.receiveShadow = rightStack.receiveShadow = true;
    frontMatterPivot.add(leftStack);
    book.add(rightStack);

    const leftMaterial = makePageMaterial(THREE.FrontSide);
    const rightMaterial = makePageMaterial(THREE.FrontSide);
    const leftGeometry = makeOpenPageGeometry("left");
    const rightGeometry = makeOpenPageGeometry("right");
    const leftPage = new THREE.Mesh(leftGeometry, leftMaterial);
    const rightPage = new THREE.Mesh(rightGeometry, rightMaterial);
    leftPage.position.set(-PAGE_W / 2, 0, 0.075);
    rightPage.position.set(PAGE_W / 2, 0, 0.08);
    leftPage.receiveShadow = rightPage.receiveShadow = true;
    frontMatterPivot.add(leftPage);
    book.add(rightPage);

    // Turning leaves use page-sized samples cut from the same full-spread RT.
    // Front and back are frozen at gesture start, so the illustrated stage
    // cannot tear or disappear while the paper geometry deforms.
    const makeTurnCaptureTarget = () => {
      const target = new THREE.WebGLRenderTarget(768, Math.round(768 * PAGE_H / PAGE_W), {
        depthBuffer: true,
        stencilBuffer: false,
      });
      target.samples = 2;
      target.texture.colorSpace = THREE.SRGBColorSpace;
      return target;
    };
    const turnCaptureTarget = makeTurnCaptureTarget();
    const backwardBaseCaptureTarget = makeTurnCaptureTarget();

    const turnLeaf = createTurnLeaf();
    const turnFrontMaterial = makePageMaterial(THREE.FrontSide);
    const turnBackMaterial = makePageMaterial(THREE.FrontSide);
    const turnEdgeMaterial = new THREE.MeshStandardMaterial({ color: 0xe8dcc4, roughness: 0.94, metalness: 0 });
    const turnPage = new THREE.Mesh(turnLeaf.geometry, [turnFrontMaterial, turnBackMaterial, turnEdgeMaterial]);
    turnPage.position.set(PAGE_W / 2, 0, 0.08);
    // The directional-light shadow of a near-vertical rectangular sheet read
    // as a black hole in the book. The watertight leaf still receives scene
    // light and its real thickness supplies the necessary edge definition.
    turnPage.castShadow = false;
    turnPage.receiveShadow = true;
    // The page deforms every frame; bypassing repeated bounds reconstruction
    // keeps the gesture smooth without risking transient frustum pop-out.
    turnPage.frustumCulled = false;
    turnPage.visible = false;
    book.add(turnPage);

    const shadowPlaneGeometry = new THREE.PlaneGeometry(11, 7);
    const shadowPlaneMaterial = new THREE.ShadowMaterial({ color: 0x130d08, opacity: 0.18 });
    const shadowPlane = new THREE.Mesh(shadowPlaneGeometry, shadowPlaneMaterial);
    shadowPlane.position.z = -0.39;
    shadowPlane.receiveShadow = true;
    book.add(shadowPlane);

    const textureLoader = new THREE.TextureLoader();
    const sceneElements = new Map<string, SceneElement>();
    const pendingAssets = new Set<string>();
    const pendingAssetAttempts = new Map<string, symbol>();
    const activeElementMounts = new Map<string, symbol>();
    const failedSceneAssets = new Set<string>();
    let desiredElementIds = new Set<string>();
    let disposed = false;
    let reportReadyForCurrentSpread: () => void = () => undefined;
    const mountSceneElement = (element: BookElement) => {
      if (sceneElements.has(element.id) || pendingAssets.has(element.id)) return;
      const frameAssetIds = element.frameAssetIds?.length ? element.frameAssetIds : null;
      const assetIds = renderedElementAssetIds(element);
      const buildElement = (assetUrl: string, frameUrls: string[], leases: AssetUrlLease[] = []) => {
        const mountAttempt = Symbol(element.id);
        activeElementMounts.set(element.id, mountAttempt);
        [...failedSceneAssets].forEach((key) => {
          if (key.startsWith(`${element.id}:`)) failedSceneAssets.delete(key);
        });
        const sceneElement = buildSceneElement(element, textureLoader, assetUrl, frameUrls, (frameIndex) => {
          if (disposed || !resourceAttemptIsCurrent(element.id, desiredElementIds, mountAttempt, activeElementMounts)) return;
          failedSceneAssets.add(`${element.id}:texture:${frameIndex}`);
          recordDiagnostic("asset:texture-load-failed", { elementId: element.id, frameIndex });
          reportFailure();
        }, () => {
          if (!disposed && resourceAttemptIsCurrent(element.id, desiredElementIds, mountAttempt, activeElementMounts)) {
            reportReadyForCurrentSpread();
          }
        });
        const disposeSceneElement = sceneElement.dispose;
        sceneElement.dispose = () => {
          disposeSceneElement();
          leases.forEach((lease) => lease.release());
        };
        return sceneElement;
      };
      if (!assetIds.some(isStoredAssetId)) {
        const sceneElement = buildElement(element.assetId, frameAssetIds ?? []);
        stageScene.add(sceneElement.root);
        sceneElements.set(element.id, sceneElement);
        return;
      }
      const assetAttempt = Symbol(element.id);
      pendingAssetAttempts.set(element.id, assetAttempt);
      pendingAssets.add(element.id);
      acquireAssetUrls(assetIds).then((leases) => {
        if (pendingAssetAttempts.get(element.id) !== assetAttempt) {
          leases.forEach((lease) => lease.release());
          return;
        }
        pendingAssetAttempts.delete(element.id);
        pendingAssets.delete(element.id);
        if (disposed || sceneElements.has(element.id) || !desiredElementIds.has(element.id)) {
          leases.forEach((lease) => lease.release());
          return;
        }
        const resolvedUrls = leases.map((lease) => lease.url);
        const sceneElement = buildElement(resolvedUrls[0] ?? element.assetId, frameAssetIds ? resolvedUrls : [], leases);
        stageScene.add(sceneElement.root);
        sceneElements.set(element.id, sceneElement);
      }).catch(() => {
        if (pendingAssetAttempts.get(element.id) !== assetAttempt) return;
        pendingAssetAttempts.delete(element.id);
        pendingAssets.delete(element.id);
        if (disposed || !desiredElementIds.has(element.id)) return;
        failedSceneAssets.add(`${element.id}:resolve`);
        recordDiagnostic("asset:resolve-failed", { elementId: element.id });
        reportFailure();
      });
    };
    const placeStaticElement = (element: BookElement, sceneElement: SceneElement, scaleMultiplier = 1) => {
      sceneElement.root.position.set(
        (spreadFraction(element) - 0.5) * 2 * PAGE_W,
        (0.5 - element.transform.y) * PAGE_H,
        element.depth,
      );
      sceneElement.root.rotation.z = THREE.MathUtils.degToRad(-element.transform.rotationDeg);
      sceneElement.root.scale.set(
        element.transform.scaleX * scaleMultiplier,
        element.transform.scaleY * scaleMultiplier,
        element.transform.scaleX * scaleMultiplier,
      );
      sceneElement.tilt.rotation.x = 0;
      sceneElement.tilt.position.y = 0;
      sceneElement.yaw.rotation.y = 0;
    };

    let lastTurnCaptureKey = "";
    const setStageCameraView = (view: "full" | "left" | "right") => {
      stageCamera.left = view === "right" ? 0 : -PAGE_W;
      stageCamera.right = view === "left" ? 0 : PAGE_W;
      stageCamera.top = PAGE_H / 2;
      stageCamera.bottom = -PAGE_H / 2;
      stageCamera.updateProjectionMatrix();
    };

    const clearColorScratch = new THREE.Color();
    const renderStageView = (
      pair: PagePair,
      target: THREE.WebGLRenderTarget,
      view: "full" | "left" | "right",
      night: boolean,
    ) => {
      const priorTarget = renderer.getRenderTarget();
      const priorClearColor = renderer.getClearColor(clearColorScratch);
      const priorClearAlpha = renderer.getClearAlpha();
      const priorAutoClear = renderer.autoClear;
      // Bumping a material's version every frame sends three down a
      // program-change path on every frame. Only bump it when the map has
      // actually been swapped.
      if (stageBackgroundMaterial.map !== pair.spread) {
        stageBackgroundMaterial.map = pair.spread;
        stageBackgroundMaterial.needsUpdate = true;
      }
      // Night is lighting, not a filter: the desk lamp and the reduced key
      // do the work, so the illustration keeps its own colour.
      stageBackgroundMaterial.color.set(0xffffff);
      if (stageOverlayMaterial.map !== pair.overlay) {
        stageOverlayMaterial.map = pair.overlay;
        stageOverlayMaterial.needsUpdate = true;
      }
      setStageCameraView(view);
      stageScene.updateMatrixWorld(true);
      renderer.setRenderTarget(target);
      renderer.autoClear = false;
      renderer.setClearColor(night ? 0x1a2029 : 0xf4ecd9, 1);
      renderer.clear(true, true, true);
      stageBackground.visible = true;
      stageOverlay.visible = false;
      renderer.render(stageFlatScene, stageCamera);
      renderer.clearDepth();
      renderer.render(stageScene, stageCamera);
      renderer.clearDepth();
      stageBackground.visible = false;
      stageOverlay.visible = true;
      renderer.render(stageFlatScene, stageCamera);
      stageBackground.visible = true;
      stageOverlay.visible = true;
      renderer.setRenderTarget(priorTarget);
      renderer.autoClear = priorAutoClear;
      renderer.setClearColor(priorClearColor, priorClearAlpha);
    };

    const configureStaticStage = (spread: Spread) => {
      const visible = new Set(spread.elements.map((element) => element.id));
      spread.elements.forEach((element) => {
        mountSceneElement(element);
        const sceneElement = sceneElements.get(element.id);
        if (!sceneElement) return;
        placeStaticElement(element, sceneElement, 1);
        sceneElement.root.visible = true;
      });
      sceneElements.forEach((sceneElement, id) => {
        if (!visible.has(id)) sceneElement.root.visible = false;
      });
    };

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


    let pagePairs = new Map<string, PagePair>();
    const spreadLoadAttempts = new Map<string, symbol>();
    let desiredSpreadIds = new Set<string>();
    let resourceWindowKey = "";
    let readySent = false;
    const sceneAssetsReady = (spread: Spread) => sceneAssetsReadyForEvidence(
      spread.elements.map((element) => element.id),
      pendingAssets,
      failedSceneAssets,
      new Map(spread.elements.flatMap((element) => {
        const mounted = sceneElements.get(element.id);
        return mounted ? [[element.id, { loaded: mounted.loadedFrameIndices.size, total: mounted.frameTextures.length }]] : [];
      })),
    );
    reportReadyForCurrentSpread = () => {
      if (disposed || readySent) return;
      const current = propsRef.current.snapshot;
      if (current.document.id !== loadingDocumentId) return;
      const spread = current.document.spreads[current.session.currentSpreadIndex];
      if (!spread || !coverReady || !pagePairs.has(spread.id) || !sceneAssetsReady(spread)) return;
      readySent = true;
      propsRef.current.onReady(loadingDocumentId);
    };
    const ensureSpreadLoaded = (spread: Spread) => {
      if (pagePairs.has(spread.id) || spreadLoadAttempts.has(spread.id)) return;
      const loadAttempt = Symbol(spread.id);
      spreadLoadAttempts.set(spread.id, loadAttempt);
      loadPagePairs([spread], propsRef.current.mode).then((pairs) => {
        if (spreadLoadAttempts.get(spread.id) !== loadAttempt) {
          pairs.forEach(({ spread: texture, overlay }) => {
            texture.dispose();
            overlay.dispose();
          });
          return;
        }
        spreadLoadAttempts.delete(spread.id);
        if (disposed || !desiredSpreadIds.has(spread.id)) {
          pairs.forEach(({ spread: texture, overlay }) => {
            texture.dispose();
            overlay.dispose();
          });
          return;
        }
        const pair = pairs.get(spread.id);
        if (pair) {
          pagePairs.set(spread.id, pair);
          reportReadyForCurrentSpread();
        }
      }).catch(() => {
        if (spreadLoadAttempts.get(spread.id) !== loadAttempt) return;
        spreadLoadAttempts.delete(spread.id);
        if (disposed || !desiredSpreadIds.has(spread.id)) return;
        recordDiagnostic("spread:load-failed", { documentId: loadingDocumentId, spreadId: spread.id });
        reportFailure();
      });
    };
    const reconcileResourceWindow = (spreads: Spread[]) => {
      const nextKey = spreads.map((spread) => spread.id).join(":");
      if (nextKey === resourceWindowKey) return;
      resourceWindowKey = nextKey;
      desiredSpreadIds = new Set(spreads.map((spread) => spread.id));
      desiredElementIds = new Set(spreads.flatMap((spread) => spread.elements.map((element) => element.id)));
      spreadLoadAttempts.forEach((_, spreadId) => {
        if (!desiredSpreadIds.has(spreadId)) spreadLoadAttempts.delete(spreadId);
      });
      pendingAssetAttempts.forEach((_, elementId) => {
        if (desiredElementIds.has(elementId)) return;
        pendingAssetAttempts.delete(elementId);
        pendingAssets.delete(elementId);
      });
      pagePairs.forEach((pair, spreadId) => {
        if (desiredSpreadIds.has(spreadId)) return;
        pair.spread.dispose();
        pair.overlay.dispose();
        pagePairs.delete(spreadId);
      });
      sceneElements.forEach((sceneElement, elementId) => {
        if (desiredElementIds.has(elementId)) return;
        activeElementMounts.delete(elementId);
        stageScene.remove(sceneElement.root);
        sceneElement.dispose();
        sceneElements.delete(elementId);
        [...failedSceneAssets].forEach((key) => {
          if (key.startsWith(`${elementId}:`)) failedSceneAssets.delete(key);
        });
      });
      spreads.forEach((spread) => {
        ensureSpreadLoaded(spread);
        spread.elements.forEach(mountSceneElement);
      });
    };
    const initialSpreadIndex = propsRef.current.snapshot.session.currentSpreadIndex;
    const initialSpread = propsRef.current.snapshot.document.spreads[initialSpreadIndex];
    // Load the visible spread first. Its neighbors join the bounded resource
    // window only after this background is ready.
    reconcileResourceWindow([initialSpread]);

    /**
     * Framing is what the container asks for; pose is what the cover animation
     * adds on top. Splitting them is what stops a window nudge mid-open from
     * snapping the camera back to the open framing - resize() used to write
     * position and lookAt directly, and a ResizeObserver fires constantly in a
     * window docked beside a chat pane.
     */
    const framing = { x: 0, z: 12.05, y: -2.169, targetY: -0.08, singlePage: false };

    function applyCamera() {
      // u rises with how far the board has swung; s peaks at the midpoint,
      // which is exactly where the swinging board reaches furthest toward the
      // lens. Every term is zero at phi = 0, so the open pose is byte-identical
      // to the framing the rest of the scene was built against.
      /**
       * The camera does not move.
       *
       * It used to pan, dolly and pitch on sin(phi), which peaks mid-swing and
       * returns to zero - an out-and-back round trip inside one navigation
       * gesture, asking the eye to follow a direction reversal at 34% while the
       * book was also translating and scaling. Worse, keying the camera to the
       * same parameter that drove the cover turned it into a jerk amplifier:
       * measured, it multiplied the easing's velocity step into a 38 units/s
       * pan jerk and a 50 units/s dolly jerk.
       *
       * It was there to keep the swinging board in frame, and it is no longer
       * needed: the book arrives from a shelf card, so it is small for most of
       * the swing and full size only once the cover is nearly flat.
       */
      camera.position.set(framing.x, framing.y, framing.z);
      camera.lookAt(framing.x, framing.targetY, 0);
      camera.updateProjectionMatrix();
    }

    /**
     * Where the canvas sits inside the stage, in CSS pixels.
     *
     * The selection ring is positioned against the stage, but the projection
     * that drives it is measured against the canvas. On a desktop the two
     * share a frame, so the difference was invisible; phone portrait insets
     * the scene below a 62px reading band, and the ring landed exactly that
     * far above the element it was supposed to circle. Cached rather than read
     * per frame because the offset can only change when the host's box does,
     * which is precisely when the observer below fires.
     */
    const sceneOffset = { x: 0, y: 0 };
    let raf = 0;

    function resize() {
      // The anchor is measured against this box, so a new box retires it.
      anchorCacheKey = undefined;
      const width = host.clientWidth;
      const height = host.clientHeight;
      // The stage is display:none while the shelf sits settled over it, so the
      // host measures 0x0 until it is revealed. Fitting to that aspect gives an
      // infinite camera distance, which then survives the next real resize as
      // NaN. Keep the last good framing until the element has a size.
      if (width < 2 || height < 2) {
        const current = propsRef.current.snapshot;
        const spread = current.document.spreads[current.session.currentSpreadIndex];
        if (spread) reconcileResourceWindow([spread]);
        return;
      }
      // Guarded on offsetParent so a future layout that repositions the scene
      // against something other than the stage degrades to "no offset" rather
      // than to a confidently wrong one.
      const framed = host.offsetParent === host.parentElement;
      sceneOffset.x = framed ? host.offsetLeft : 0;
      sceneOffset.y = framed ? host.offsetTop : 0;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const halfFov = Math.tan(verticalFov / 2);
      framing.singlePage = propsRef.current.mode === "reader"
        && getComputedStyle(host).getPropertyValue("--reader-single-page").trim() === "1";
      const horizontalFit = (framing.singlePage ? BOARD_W + 0.45 : 9.7) / (2 * halfFov * camera.aspect);
      const verticalFit = framing.singlePage ? (BOARD_H + 0.3) / (2 * halfFov) : 0;
      framing.z = framing.singlePage ? Math.max(horizontalFit, verticalFit) : Math.max(12.05, horizontalFit);
      framing.y = framing.z * -0.18;
      // The aim used to step 1.67 world units in one frame as a window crossed
      // aspect 0.65. Smoothstep makes the same decision continuously.
      const t = THREE.MathUtils.smoothstep(camera.aspect, 0.58, 0.72);
      framing.targetY = THREE.MathUtils.lerp(-1.75, -0.08, t);
      framing.x = readerCameraPage(propsRef.current.mode, framing.singlePage) === "right" ? PAGE_W / 2 : 0;
      applyCamera();
      scheduleAnimation();
    }
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();
    // The joint defaults to its closed transform, so the case has to be placed
    // once before the first frame or a reader who never triggers an open sees
    // a shut book.
    coverPhi = phiFor(propsRef.current.openProgress.current);
    applyCover();
    // resize() owns the camera and refuses to run against a 0x0 host, so a
    // stage that mounts hidden would otherwise never have it placed at all.
    applyCamera();

    const bookPointer = createBookPointer({
      canvas: renderer.domElement,
      camera,
      stageCamera,
      pages: [leftPage, rightPage],
      sceneElements,
      props: () => propsRef.current,
      scheduleAnimation,
    });
    bookPointer.attach();

    const anchorWorld = new THREE.Vector3();
    let lastFrameTime = performance.now();
    let lastSpreadId = "";
    let lastWorkshopPaintKey = "";
    /** When each spread revision first became visible; a revisited spread never replays. */
    const revealStarts = new Map<string, number>();
    /** The pencil plan fading off the created book's first spread; plays once per book. */
    const SKETCH_FADE_MS = 600;
    const sketchFadedDocuments = new Set<string>();
    let sketchFade: { spreadId: string; spread: StoryboardSpread; base: HTMLCanvasElement; start: number; step: number } | null = null;
    let renderedEvidenceKey = "";
    let renderedEvidenceCandidate = "";
    let renderedEvidenceFrames = 0;
    const lastPageTurnReadiness: Record<"forward" | "backward", boolean | null> = {
      forward: null,
      backward: null,
    };
    let lastReadinessKey = "";
    const dayPaperColor = new THREE.Color(0xfffbef);
    const nightPaperColor = new THREE.Color(0xf6efe2);
    const dayPageBlockColor = new THREE.Color(0xe8dcc4);
    const nightPageBlockColor = new THREE.Color(0x5f554d);
    const dayEdgeColor = new THREE.Color(0xe8dcc4);
    const nightEdgeColor = new THREE.Color(0xb59367);
    const dayParticleColor = new THREE.Color(0xc7aa7a);
    const nightParticleColor = new THREE.Color(0xffc75f);
    const dayKeyColor = new THREE.Color(0xffe9c6);
    const nightKeyColor = new THREE.Color(0x9fb7d8);
    const dayAmbientSky = new THREE.Color(0xfff4dc);
    const dayAmbientGround = new THREE.Color(0x675b4b);
    const nightAmbientSky = new THREE.Color(0x8ea6c7);
    const nightAmbientGround = new THREE.Color(0x1b2230);
    const dayCoverColor = new THREE.Color(0x173f39);
    const nightCoverColor = new THREE.Color(0x261912);
    backwardBaseCaptureTarget.texture.repeat.x = -1;
    backwardBaseCaptureTarget.texture.offset.x = 1;

    function scheduleAnimation() {
      if (disposed || raf !== 0 || host.clientWidth < 2 || host.clientHeight < 2) return;
      raf = requestAnimationFrame(animate);
    }

    function animate() {
      raf = 0;
      const { snapshot: current, turn: currentTurn } = propsRef.current;
      const spread = current.document.spreads[current.session.currentSpreadIndex];
      const pagePair = pagePairs.get(spread.id);
      const previous = current.document.spreads[current.session.currentSpreadIndex - 1];
      const next = current.document.spreads[current.session.currentSpreadIndex + 1];
      const readinessKey = `${current.document.id}:${current.document.revision}:${current.session.currentSpreadIndex}`;
      if (lastReadinessKey !== readinessKey) {
        lastReadinessKey = readinessKey;
        lastPageTurnReadiness.backward = null;
        lastPageTurnReadiness.forward = null;
      }
      // Readiness is about textures, not about paint, and the shelf is waiting
      // on it to know the book can be opened at all. It has to be reported from
      // behind the curtain, which is why it is answered before the curtain is
      // checked.
      reportReadyForCurrentSpread();

      /**
       * Nothing below this line can be seen while the shelf sits settled over
       * the stage: `hidden` puts the whole section at display:none, so the host
       * measures 0x0 - the same condition resize() already refuses to fit to.
       *
       * The scene deliberately stays mounted through that, so the book is warm
       * the moment a reader picks one. The resize observer restarts the loop
       * when the stage becomes visible; while hidden there is no recurring rAF.
       * Otherwise each frame would issue four render passes - three into a fixed
       * 1536x947 target with 2x MSAA, plus a 1024-square shadow map - for a canvas
       * nobody can see on the app's own landing screen.
       */
      if (host.clientWidth < 2 || host.clientHeight < 2) {
        reconcileResourceWindow([spread]);
        return;
      }

      const resourceSpreads = spreadResourceIndexes(
        current.session.currentSpreadIndex,
        current.document.spreads.length,
        Boolean(pagePair),
      ).map((index) => current.document.spreads[index]);
      reconcileResourceWindow(resourceSpreads);
      if (pagePair) {
        const currentSceneReady = sceneAssetsReady(spread);
        const readiness = {
          backward: currentSceneReady && (!previous || (pagePairs.has(previous.id) && sceneAssetsReady(previous))),
          forward: currentSceneReady && (!next || (pagePairs.has(next.id) && sceneAssetsReady(next))),
        };
        (["backward", "forward"] as const).forEach((direction) => {
          if (lastPageTurnReadiness[direction] === readiness[direction]) return;
          lastPageTurnReadiness[direction] = readiness[direction];
          propsRef.current.onPageTurnReady?.(direction, readiness[direction]);
        });
      }

      const night = current.session.sceneThemeId === "midnight-desk";
      const reduced = current.session.quality === "reduced";
      const requestedOpen = propsRef.current.mode === "workshop" ? 1 : propsRef.current.openProgress.current;
      const lampReveal = smootherstep(clamp01((requestedOpen - 0.42) / 0.58));
      const frameTime = performance.now();
      const deltaSeconds = Math.min(0.05, (frameTime - lastFrameTime) / 1000);
      const delta = clamp01(deltaSeconds * 4);
      // Presentation state should acknowledge a mobile tap immediately and
      // settle quickly. Keep content/interaction motion on its own cadence.
      const themeDelta = 1 - Math.exp(-deltaSeconds * 13);
      lastFrameTime = frameTime;

      if (pagePair && propsRef.current.mode === "workshop") {
        renderer.domElement.style.cursor = propsRef.current.annotationEnabled ? "crosshair" : "";
        const drawing = propsRef.current.workshopDrawing;
        const sketchKey = `${current.session.currentSpreadIndex}:${drawing?.spread?.sketchRevision ?? 0}`;
        if (!revealStarts.has(sketchKey)) revealStarts.set(sketchKey, frameTime);
        const revealMs = Math.min(MAX_REVEAL_MS, (drawing?.spread?.marks.length ?? 0) * MARK_REVEAL_MS);
        const revealProgress = reduced || revealMs === 0
          ? 1
          : clamp01((frameTime - (revealStarts.get(sketchKey) ?? frameTime)) / revealMs);
        const paintKey = `${drawing?.revision ?? 0}:${current.session.currentSpreadIndex}:${bookPointer.state.annotationDraft.length}:${Math.round(revealProgress * 60)}:${getSketchImageVersion()}`;
        if (paintKey !== lastWorkshopPaintKey) {
          lastWorkshopPaintKey = paintKey;
          paintWorkshopDrawing(pagePair, drawing?.spread, bookPointer.state.annotationDraft, revealProgress);
        }
      } else if (pagePair) {
        // The book Codex just created opens wearing its own pencil plan for a
        // moment, so the reader sees the sketch become the art.
        if (sketchFade && sketchFade.spreadId !== spread.id) {
          const left = pagePairs.get(sketchFade.spreadId);
          if (left) paintSketchFade(left, sketchFade.spread, sketchFade.base, 0);
          sketchFade = null;
        }
        const plan = propsRef.current.workshopDrawing?.spread;
        // Not before the loading curtain lifts, or the fade plays to nobody.
        if (plan?.marks.length && readySent && !sketchFadedDocuments.has(current.document.id)) {
          sketchFadedDocuments.add(current.document.id);
          const base = reduced ? null : snapshotOverlay(pagePair);
          if (base) sketchFade = { spreadId: spread.id, spread: plan, base, start: frameTime, step: -1 };
        }
        if (sketchFade) {
          const progress = clamp01((frameTime - sketchFade.start) / SKETCH_FADE_MS);
          const step = Math.round(progress * 30);
          if (step !== sketchFade.step) {
            sketchFade.step = step;
            paintSketchFade(pagePair, sketchFade.spread, sketchFade.base, 1 - progress);
          }
          if (progress >= 1) sketchFade = null;
        }
      }

      const selectedPage = requestedOpen >= 0.999
        ? spread.elements.find((element) => element.id === current.session.selectionId)?.page
        : undefined;
      const cameraPage = readerCameraPage(propsRef.current.mode, framing.singlePage, selectedPage);
      const singlePagePresentation = readerSinglePagePresentation(
        propsRef.current.mode,
        framing.singlePage,
        requestedOpen,
        selectedPage,
        currentTurn?.direction === "forward",
      );
      // Portrait is a real one-page binding, not a camera crop across an open
      // spread. The shell stays put while either authored page is placed into
      // it, so selecting a left-page element never exposes the missing half.
      const cameraTargetX = singlePagePresentation
        ? PAGE_W / 2
        : cameraPage === "left" ? -PAGE_W / 2 : cameraPage === "right" ? PAGE_W / 2 : 0;
      const cameraX = reduced ? cameraTargetX : THREE.MathUtils.lerp(framing.x, cameraTargetX, themeDelta);
      if (Math.abs(cameraX - framing.x) > 1e-4) {
        framing.x = cameraX;
        applyCamera();
      }
      ambient.intensity = THREE.MathUtils.lerp(ambient.intensity, night ? 1.0 : 1.7, themeDelta);
      ambient.color.lerp(night ? nightAmbientSky : dayAmbientSky, themeDelta);
      ambient.groundColor.lerp(night ? nightAmbientGround : dayAmbientGround, themeDelta);
      key.intensity = THREE.MathUtils.lerp(key.intensity, night ? 3.0 : 3.6, themeDelta);
      key.color.lerp(night ? nightKeyColor : dayKeyColor, themeDelta);
      rim.intensity = THREE.MathUtils.lerp(rim.intensity, night ? 1.85 : 0.6, themeDelta);
      stageAmbient.intensity = THREE.MathUtils.lerp(stageAmbient.intensity, night ? 1.05 : 1.9, themeDelta);
      stageAmbient.color.lerp(night ? nightAmbientSky : dayAmbientSky, themeDelta);
      stageAmbient.groundColor.lerp(night ? nightAmbientGround : dayAmbientGround, themeDelta);
      stageKey.intensity = THREE.MathUtils.lerp(stageKey.intensity, night ? 3.1 : 4.2, themeDelta);
      stageKey.color.lerp(night ? nightKeyColor : dayKeyColor, themeDelta);
      stageRim.intensity = THREE.MathUtils.lerp(stageRim.intensity, night ? 2.2 : 0.8, themeDelta);
      pageHalo.intensity = THREE.MathUtils.lerp(pageHalo.intensity, night ? 1.55 * lampReveal : 0, themeDelta);
      deskLamp.intensity = THREE.MathUtils.lerp(deskLamp.intensity, night ? 9.8 * lampReveal : 0, themeDelta);
      coverMaterial.color.lerp(night ? nightCoverColor : dayCoverColor, themeDelta);
      if (!coverFaceMaterial.map) coverFaceMaterial.color.lerp(night ? nightCoverColor : dayCoverColor, themeDelta);
      if (!insideCoverMaterial.map) insideCoverMaterial.color.lerp(night ? nightCoverColor : dayCoverColor, themeDelta);
      pageBlockMaterial.color.lerp(night ? nightPageBlockColor : dayPageBlockColor, themeDelta);
      turnEdgeMaterial.color.lerp(night ? nightEdgeColor : dayEdgeColor, themeDelta);
      [leftMaterial, rightMaterial, turnFrontMaterial, turnBackMaterial].forEach((material) => {
        material.color.lerp(night ? nightPaperColor : dayPaperColor, themeDelta);
        material.roughness = THREE.MathUtils.lerp(material.roughness, night ? 0.74 : 0.82, themeDelta);
        material.emissiveIntensity = THREE.MathUtils.lerp(material.emissiveIntensity, night ? 0.09 : 0, themeDelta);
      });
      particleMaterial.color.lerp(night ? nightParticleColor : dayParticleColor, themeDelta);
      particleMaterial.opacity = THREE.MathUtils.lerp(particleMaterial.opacity, reduced ? 0 : night ? 0.72 : 0.1, themeDelta);
      particleMaterial.size = THREE.MathUtils.lerp(particleMaterial.size, night ? 0.044 : 0.025, themeDelta);
      particles.rotation.z += reduced ? 0 : night ? 0.00032 : -0.000045;
      renderer.toneMappingExposure = THREE.MathUtils.lerp(renderer.toneMappingExposure, night ? 1.08 : 1.03, themeDelta);

      const time = frameTime;
      let focusIntensity = 0;
      spread.elements.forEach((element) => {
        mountSceneElement(element);
      });
      sceneElements.forEach((sceneElement, id) => {
        const element = spread.elements.find((item) => item.id === id);
        sceneElement.root.visible = Boolean(element);
        if (!element) {
          sceneElement.hoverAmount = 0;
          sceneElement.focusAmount = 0;
          return;
        }

        const interaction = resolveInteraction(element);
        const hover = hoverTraits(interaction.hover);
        const focus = focusTraits(interaction.focus);
        const hovered = bookPointer.state.hoveredId === id && !current.session.preview && !currentTurn;
        const focused = current.session.selectionId === id && !currentTurn;
        sceneElement.hoverAmount = THREE.MathUtils.lerp(sceneElement.hoverAmount, hovered ? 1 : 0, clamp01(deltaSeconds * 7));
        sceneElement.focusAmount = THREE.MathUtils.lerp(sceneElement.focusAmount, focused ? 1 : 0, clamp01(deltaSeconds * 5));

        let x = (spreadFraction(element) - 0.5) * 2 * PAGE_W;
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
        sceneElement.root.position.set(x, y, element.depth + rise);
        sceneElement.root.rotation.z = THREE.MathUtils.degToRad(-element.transform.rotationDeg);
        const appliedScale = scale * interactionScale;
        sceneElement.root.scale.set(appliedScale, element.transform.scaleY * (appliedScale / element.transform.scaleX), appliedScale);

        // Hover lean follows the live pointer; focus orbit is a named response.
        const leanTarget = hovered && !reduced ? bookPointer.stagePointer.x * hover.tilt * 2.4 : 0;
        const pitchTarget = hovered && !reduced ? -bookPointer.stagePointer.y * hover.tilt : 0;
        const spinDelta = focused && !reduced ? focus.spin * deltaSeconds : 0;
        sceneElement.spin += spinDelta;
        sceneElement.yaw.rotation.y = THREE.MathUtils.lerp(sceneElement.yaw.rotation.y, sceneElement.spin + leanTarget, clamp01(deltaSeconds * 6));
        sceneElement.tilt.rotation.x = THREE.MathUtils.lerp(sceneElement.tilt.rotation.x, pitchTarget * 0.35, clamp01(deltaSeconds * 6));
        // A layer without an authored motion preset stays physically anchored
        // to the paper. Clickability comes from hover light/focus treatment,
        // never from a global idle bob applied to every subject.
        sceneElement.tilt.position.y = THREE.MathUtils.lerp(sceneElement.tilt.position.y, 0, clamp01(deltaSeconds * 8));

        const glow = hover.emissive * sceneElement.hoverAmount + 0.1 * sceneElement.focusAmount;
        if (sceneElement.frameTextures.length > 1) {
          const frameIndex = frameSequenceIndex(sceneElement.frameTextures.length, time, reduced);
          if (frameIndex !== sceneElement.frameIndex) {
            sceneElement.frameIndex = frameIndex;
            sceneElement.materials[0].map = sceneElement.frameTextures[frameIndex];
            sceneElement.materials[0].needsUpdate = true;
          }
        }
        sceneElement.materials.forEach((material) => {
          material.emissiveIntensity = glow;
        });

        if (focused) {
          focusIntensity = Math.max(focusIntensity, focus.spotlight * sceneElement.focusAmount);
          sceneElement.anchor.getWorldPosition(anchorWorld);
          focusTarget.position.copy(anchorWorld);
          focusLight.position.set(anchorWorld.x - 0.6, anchorWorld.y + 3.1, anchorWorld.z + 4.6);
          anchorWorld.set(anchorWorld.x, anchorWorld.y, 0.42);
          if (singlePagePresentation && element.page === "left") anchorWorld.x += PAGE_W;
          book.localToWorld(anchorWorld);
          anchorWorld.project(camera);
          const screenX = sceneOffset.x + (anchorWorld.x * 0.5 + 0.5) * host.clientWidth;
          const screenY = sceneOffset.y + (-anchorWorld.y * 0.5 + 0.5) * host.clientHeight;
          host.parentElement?.style.setProperty("--selection-x", `${screenX}px`);
          host.parentElement?.style.setProperty("--selection-y", `${screenY}px`);
        }
      });
      focusLight.intensity = THREE.MathUtils.lerp(focusLight.intensity, focusIntensity, delta);

      if (pagePair) {
        renderStageView(pagePair, liveSpreadTarget, "full", night);
        if (currentTurn) {
          const plan = resolveTurnContentPlan(current.session.currentSpreadIndex, currentTurn.direction, current.document.spreads.length);
          const destinationSpread = plan ? current.document.spreads[plan.destinationIndex] : undefined;
          const destinationPair = destinationSpread ? pagePairs.get(destinationSpread.id) : undefined;
          const destinationReady = destinationSpread && destinationPair && sceneAssetsReady(destinationSpread);
          const themeKey = night ? "night" : "day";
          if (destinationSpread && destinationPair && destinationReady) {
            configureStaticStage(destinationSpread);
            renderStageView(destinationPair, destinationSpreadTarget, "full", night);
            const captureKey = `${currentTurn.direction}:${spread.id}:${destinationSpread.id}:${themeKey}`;
            if (captureKey !== lastTurnCaptureKey) {
              const frontSpread = currentTurn.direction === "forward" ? spread : destinationSpread;
              const frontPair = currentTurn.direction === "forward" ? pagePair : destinationPair;
              const backSpread = currentTurn.direction === "forward" ? destinationSpread : spread;
              const backPair = currentTurn.direction === "forward" ? destinationPair : pagePair;
              const frontView = framing.singlePage && currentTurn.direction === "forward"
                ? selectedPage ?? "right"
                : "right";
              const backView = framing.singlePage
                ? currentTurn.direction === "backward" ? selectedPage ?? "right" : "right"
                : "left";
              configureStaticStage(frontSpread);
              renderStageView(frontPair, turnCaptureTarget, frontView, night);
              configureStaticStage(backSpread);
              renderStageView(backPair, backwardBaseCaptureTarget, backView, night);
              lastTurnCaptureKey = captureKey;
              recordDiagnostic("page-turn:capture", {
                spreadId: frontSpread.id,
                destinationSpreadId: destinationSpread.id,
                elementCount: frontSpread.elements.length + backSpread.elements.length,
                role: "shared-spread-rt",
              });
            }
            leftMaterial.map = currentTurn.direction === "backward" && !framing.singlePage
              ? destinationSpreadTarget.texture
              : liveSpreadTarget.texture;
            rightMaterial.map = currentTurn.direction === "forward" ? destinationSpreadTarget.texture : liveSpreadTarget.texture;
            turnFrontMaterial.map = turnCaptureTarget.texture;
            turnBackMaterial.map = backwardBaseCaptureTarget.texture;
            leftMaterial.needsUpdate = rightMaterial.needsUpdate = true;
            turnFrontMaterial.needsUpdate = turnBackMaterial.needsUpdate = true;
          }
          setStageCameraView("full");
          turnPage.visible = true;
          turnLeaf.update(currentTurn.progress);
        } else {
          if (spread.id !== lastSpreadId || leftMaterial.map !== liveSpreadTarget.texture || rightMaterial.map !== liveSpreadTarget.texture) {
            leftMaterial.map = liveSpreadTarget.texture;
            rightMaterial.map = liveSpreadTarget.texture;
            leftMaterial.needsUpdate = rightMaterial.needsUpdate = true;
            lastSpreadId = spread.id;
          }
          turnPage.visible = false;
          lastTurnCaptureKey = "";
        }
      }
      // In portrait the right-hand binding becomes a complete single-page
      // object. Reuse the existing left page when its element is selected, but
      // keep the opposite board and paper block out of the frame entirely.
      const singlePageBook = singlePagePresentation !== null;
      const showLeftPage = singlePagePresentation === "left";
      frontBoardPivot.visible = !singlePageBook;
      leftStack.visible = !singlePageBook;
      leftPage.visible = !singlePageBook || showLeftPage;
      leftPage.position.x = showLeftPage ? PAGE_W / 2 : -PAGE_W / 2;
      rightPage.visible = !singlePageBook || !showLeftPage;

      // The case follows the caller's progress rather than owning a timeline of
      // its own, so opening and closing are the same code path read in
      // opposite directions.
      // The workshop shows a blank book that is never closed, so it ignores the
      // caller's progress rather than inheriting the library's closed state.
      const requestedPhi = phiFor(requestedOpen);
      if (Math.abs(requestedPhi - coverPhi) > 1e-4) {
        coverPhi = requestedPhi;
        applyCover();
      }

      // The case travels from its shelf slot to the reading position on the
      // same progress that swings it open, so picking a book up is one gesture
      // instead of a cut followed by an animation.
      const settled = requestedOpen >= 0.999;
      const anchor = settled ? null : shelfAnchor();
      if (anchor) {
        const t = THREE.MathUtils.clamp(requestedOpen, 0, 1);
        // Arrives slightly ahead of the swing, but eased to a stop rather than
        // clamped: min(1, t/0.82) cut the book's velocity from 1.53/s to zero
        // in one frame at 421ms, while the cover was still turning at 226 deg/s.
        const travel = smootherstep(t / 0.85);
        const scale = THREE.MathUtils.lerp(anchor.scale, 1, travel);
        const coverHalfWidth = (spineGap + BOARD_W) / 2;
        book.position.x = caseHandoffGroupX(
          anchor.x,
          scale,
          coverHalfWidth * Math.cos(frontBoardPivot.rotation.y),
          coverHalfWidth * Math.cos(-(Math.PI - FLAT_PHI)),
          travel,
        );
        book.position.y = THREE.MathUtils.lerp(anchor.y, bookRestY, travel);
        book.scale.setScalar(scale);
      } else if (book.scale.x !== 1 || book.position.x !== 0) {
        book.position.set(0, bookRestY, 0);
        book.scale.setScalar(1);
      }

      // Thickness moves from the right stack to the left as the reader
      // advances. The sum is conserved, so the book never appears to grow.
      const spreadTotal = current.document.spreads.length;
      const blockDepth = textBlockDepth(spreadTotal);
      const leftShare = (current.session.currentSpreadIndex + 1) / (spreadTotal + 1);
      seatStack(leftStack, -PAGE_W / 2, THREE.MathUtils.lerp(leftStack.scale.z, blockDepth * leftShare, delta));
      seatStack(rightStack, PAGE_W / 2, THREE.MathUtils.lerp(rightStack.scale.z, blockDepth * (1 - leftShare), delta));

      renderer.render(scene, camera);
      const currentSceneAssetsReady = sceneAssetsReady(spread);
      if (pagePair && currentSceneAssetsReady && !currentTurn && mode === "reader") {
        const evidenceToken = propsRef.current.renderEvidenceToken ?? "";
        const evidenceKey = `${current.document.id}:${current.document.revision}:${spread.id}:${current.session.sceneThemeId}:${evidenceToken}`;
        if (evidenceKey !== renderedEvidenceCandidate) {
          renderedEvidenceCandidate = evidenceKey;
          renderedEvidenceFrames = 0;
        } else {
          renderedEvidenceFrames += 1;
        }
        if (renderedEvidenceFrames >= 8 && renderedEvidenceKey !== evidenceKey) {
          renderedEvidenceKey = evidenceKey;
          propsRef.current.onRendered?.({
            sceneKey: sceneStructureKey,
            renderEvidenceToken: propsRef.current.renderEvidenceToken,
            documentId: current.document.id,
            revision: current.document.revision,
            spreadId: spread.id,
            theme: current.session.sceneThemeId,
            surface: "webgl",
            locator: ".book-scene canvas",
          });
        }
      } else {
        renderedEvidenceCandidate = "";
        renderedEvidenceFrames = 0;
      }
      scheduleAnimation();
    }
    scheduleAnimation();

    return () => {
      disposed = true;
      desiredSpreadIds.clear();
      desiredElementIds.clear();
      spreadLoadAttempts.clear();
      pendingAssetAttempts.clear();
      pendingAssets.clear();
      activeElementMounts.clear();
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      bookPointer.detach();
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      pagePairs.forEach(({ spread, overlay }) => {
        spread.dispose();
        overlay.dispose();
      });
      sceneElements.forEach((sceneElement) => sceneElement.dispose());
      // The case, the two text blocks and the contact shadow are built once per
      // scene and were never released, so every trip out to the shelf and back
      // left one more copy of them resident on the GPU. Meshes that share a
      // buffer are freed once: the right stack is a clone of the left, and both
      // boards paint from the same cover and endpaper materials.
      leftGeometry.dispose();
      rightGeometry.dispose();
      leftMaterial.dispose();
      rightMaterial.dispose();
      spineShell.geometry.dispose();
      spineMaterial.dispose();
      rearBoard.geometry.dispose();
      frontBoard.geometry.dispose();
      coverMaterial.dispose();
      coverFaceMaterial.map?.dispose();
      coverFaceMaterial.dispose();
      insideCoverMaterial.dispose();
      endpaperTexture.dispose();
      endpaperMaterial.dispose();
      pageBlockGeometry.dispose();
      pageBlockMaterial.dispose();
      shadowPlaneGeometry.dispose();
      shadowPlaneMaterial.dispose();
      turnLeaf.geometry.dispose();
      turnFrontMaterial.dispose();
      turnBackMaterial.dispose();
      turnEdgeMaterial.dispose();
      turnCaptureTarget.dispose();
      backwardBaseCaptureTarget.dispose();
      liveSpreadTarget.dispose();
      destinationSpreadTarget.dispose();
      stageBackgroundGeometry.dispose();
      stageBackgroundMaterial.dispose();
      stageOverlayGeometry.dispose();
      stageOverlayMaterial.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      recordDiagnostic("webgl:disposed");
    };
  }, [sceneStructureKey]);

  return <div className="book-scene" ref={hostRef} />;
}
