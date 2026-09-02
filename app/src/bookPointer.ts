/**
 * Pointer input on the WebGL book: hover picking, element drag, edge page
 * gestures, and the workshop's red-pencil strokes. It owns no rendering. The
 * renderer passes in its camera, pages and scene elements, reads the state
 * this controller exposes each frame, and is otherwise unaware of events.
 */
import * as THREE from "three";
import { PAGE_H, PAGE_W, type SceneElement } from "./bookGeometry";
import { clamp01 } from "./pageTurn";
import { spreadFraction } from "./stageGeometry";
import type { StoryboardPoint, StoryboardStroke } from "./storyboard";
import type { BookSnapshot, TurnState } from "./types";

export type BookPointerProps = {
  snapshot: BookSnapshot;
  turn: TurnState;
  annotationEnabled: boolean;
  readOnly: boolean;
  onSelect: (elementId: string | null) => void;
  onHover: (elementId: string | null) => void;
  onMoveElement: (elementId: string, x: number, y: number) => void;
  onPageGesture: (direction: "forward" | "backward", phase: "start" | "move" | "end", amount: number) => void;
  onAnnotationStroke?: (stroke: StoryboardStroke) => void;
};

type BookPointerDeps = {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  stageCamera: THREE.Camera;
  /** The two resting pages; a hit on either yields page-space coordinates. */
  pages: THREE.Object3D[];
  sceneElements: Map<string, SceneElement>;
  props: () => BookPointerProps;
  scheduleAnimation: () => void;
};

export function createBookPointer({ canvas, camera, stageCamera, pages, sceneElements, props, scheduleAnimation }: BookPointerDeps) {
  const currentSpread = () => {
    const { snapshot } = props();
    return snapshot.document.spreads[snapshot.session.currentSpreadIndex];
  };
  const raycaster = new THREE.Raycaster();
  const pageRaycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  /** Stage-space pointer, read by the frame loop for hover lean. */
  const stagePointer = new THREE.Vector2();
  const drag = { elementId: null as string | null, startX: 0, startY: 0, initialX: 0, initialY: 0, moved: false, pageDirection: null as "forward" | "backward" | null, amount: 0 };
  const state = {
    hoveredId: null as string | null,
    /** The red mark being drawn right now, painted live by the frame loop. */
    annotationDraft: [] as StoryboardPoint[],
    annotationPointerId: null as number | null,
  };

  function setPointer(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    pageRaycaster.setFromCamera(pointer, camera);
    const pageHit = pageRaycaster.intersectObjects(pages, false)[0];
    if (pageHit?.uv) stagePointer.set(pageHit.uv.x * 2 - 1, pageHit.uv.y * 2 - 1);
    else stagePointer.copy(pointer);
    return {
      rect,
      pagePoint: pageHit?.uv ? { x: pageHit.uv.x, y: 1 - pageHit.uv.y } : null,
    };
  }

  function pickElement() {
    raycaster.setFromCamera(stagePointer, stageCamera);
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
    if (state.hoveredId === elementId) return;
    state.hoveredId = elementId;
    canvas.style.cursor = props().annotationEnabled ? "crosshair" : elementId ? "pointer" : "";
    props().onHover(elementId);
  }

  function onPointerDown(event: PointerEvent) {
    const { rect, pagePoint } = setPointer(event);
    const current = props();
    if (current.annotationEnabled && pagePoint) {
      state.annotationDraft = [pagePoint];
      state.annotationPointerId = event.pointerId;
      setHovered(null);
      canvas.setPointerCapture(event.pointerId);
      scheduleAnimation();
      return;
    }
    const elementId = pickElement();
    if (elementId) {
      const element = currentSpread().elements.find((item) => item.id === elementId);
      current.onSelect(elementId);
      if (element && !element.locked && !current.readOnly) {
        drag.elementId = elementId;
        drag.startX = event.clientX;
        drag.startY = event.clientY;
        drag.initialX = element.transform.x;
        drag.initialY = element.transform.y;
        drag.moved = false;
        canvas.setPointerCapture(event.pointerId);
      }
      return;
    }
    const x = (event.clientX - rect.left) / rect.width;
    const index = current.snapshot.session.currentSpreadIndex;
    const count = current.snapshot.document.spreads.length;
    if (x > 0.74 && index < count - 1) drag.pageDirection = "forward";
    else if (x < 0.26 && index > 0) drag.pageDirection = "backward";
    if (drag.pageDirection) {
      drag.startX = event.clientX;
      drag.amount = 0;
      current.onPageGesture(drag.pageDirection, "start", 0);
      canvas.setPointerCapture(event.pointerId);
    } else current.onSelect(null);
  }

  function onPointerMove(event: PointerEvent) {
    const { pagePoint } = setPointer(event);
    if (state.annotationPointerId === event.pointerId) {
      const previous = state.annotationDraft[state.annotationDraft.length - 1];
      if (pagePoint && (!previous || Math.hypot(pagePoint.x - previous.x, pagePoint.y - previous.y) >= 0.003)) {
        state.annotationDraft.push(pagePoint);
        scheduleAnimation();
      }
      return;
    }
    if (drag.elementId) {
      const rect = canvas.getBoundingClientRect();
      const element = currentSpread().elements.find((item) => item.id === drag.elementId);
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 2) drag.moved = true;
      const nextX = clamp01(drag.initialX + (event.clientX - drag.startX) / (rect.width * 0.5));
      const nextY = clamp01(drag.initialY + (event.clientY - drag.startY) / (rect.height * 0.72));
      const sceneElement = sceneElements.get(drag.elementId);
      if (sceneElement && element) {
        sceneElement.root.position.x = (spreadFraction({ page: element.page, transform: { x: nextX } }) - 0.5) * 2 * PAGE_W;
        sceneElement.root.position.y = (0.5 - nextY) * PAGE_H;
      }
      return;
    }
    if (drag.pageDirection) {
      const rect = canvas.getBoundingClientRect();
      const delta = drag.pageDirection === "forward" ? drag.startX - event.clientX : event.clientX - drag.startX;
      drag.amount = clamp01(delta / (rect.width * 0.42));
      props().onPageGesture(drag.pageDirection, "move", drag.amount);
      return;
    }
    setHovered(props().turn ? null : pickElement());
  }

  function onPointerUp(event: PointerEvent) {
    const { pagePoint } = setPointer(event);
    const current = props();
    if (state.annotationPointerId === event.pointerId) {
      const previous = state.annotationDraft[state.annotationDraft.length - 1];
      if (pagePoint && (!previous || Math.hypot(pagePoint.x - previous.x, pagePoint.y - previous.y) >= 0.003)) state.annotationDraft.push(pagePoint);
      if (state.annotationDraft.length >= 2) current.onAnnotationStroke?.({ points: state.annotationDraft });
      state.annotationDraft = [];
      state.annotationPointerId = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      canvas.style.cursor = current.annotationEnabled ? "crosshair" : "";
      scheduleAnimation();
      return;
    }
    if (drag.elementId) {
      const rect = canvas.getBoundingClientRect();
      const nextX = clamp01(drag.initialX + (event.clientX - drag.startX) / (rect.width * 0.5));
      const nextY = clamp01(drag.initialY + (event.clientY - drag.startY) / (rect.height * 0.72));
      if (drag.moved) current.onMoveElement(drag.elementId, nextX, nextY);
      drag.elementId = null;
      drag.moved = false;
    }
    if (drag.pageDirection) {
      current.onPageGesture(drag.pageDirection, "end", drag.amount);
      drag.pageDirection = null;
      drag.amount = 0;
    }
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }

  function onPointerLeave() {
    if (state.annotationPointerId !== null) return;
    setHovered(null);
  }

  return {
    stagePointer,
    state,
    attach() {
      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerUp);
      canvas.addEventListener("pointerleave", onPointerLeave);
    },
    detach() {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
    },
  };
}
