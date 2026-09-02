import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { PAGE_H, PAGE_W, makeOpenPageGeometry, makePageMaterial } from "./bookGeometry";
import { createBookPointer, type BookPointerProps } from "./bookPointer";
import { bookEngine } from "./bookEngine";

/**
 * A real camera and real page meshes placed as ThreeBook places them, so the
 * raycast is genuine; only the canvas is a stand-in that records listeners.
 */
function harness(overrides: Partial<BookPointerProps> = {}) {
  const listeners = new Map<string, (event: PointerEvent) => void>();
  const canvas = {
    style: { cursor: "" },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => false,
    releasePointerCapture: vi.fn(),
    addEventListener: (type: string, handler: (event: PointerEvent) => void) => listeners.set(type, handler),
    removeEventListener: (type: string) => listeners.delete(type),
  } as unknown as HTMLCanvasElement;
  const camera = new THREE.PerspectiveCamera(32, 800 / 600, 0.1, 100);
  camera.position.set(0, -2.25, 12.05);
  camera.lookAt(0, -0.08, 0);
  camera.updateMatrixWorld();
  const leftPage = new THREE.Mesh(makeOpenPageGeometry("left"), makePageMaterial(THREE.FrontSide));
  const rightPage = new THREE.Mesh(makeOpenPageGeometry("right"), makePageMaterial(THREE.FrontSide));
  leftPage.position.x = -PAGE_W / 2;
  rightPage.position.x = PAGE_W / 2;
  leftPage.updateMatrixWorld();
  rightPage.updateMatrixWorld();
  const stageCamera = new THREE.OrthographicCamera(-PAGE_W, PAGE_W, PAGE_H / 2, -PAGE_H / 2, 0.1, 30);
  const snapshot = bookEngine.getSnapshot();
  const props: BookPointerProps = {
    snapshot,
    turn: null,
    annotationEnabled: false,
    readOnly: true,
    onSelect: vi.fn(),
    onHover: vi.fn(),
    onMoveElement: vi.fn(),
    onPageGesture: vi.fn(),
    onAnnotationStroke: vi.fn(),
    ...overrides,
  };
  const scheduleAnimation = vi.fn();
  const pointer = createBookPointer({
    canvas, camera, stageCamera, pages: [leftPage, rightPage], sceneElements: new Map(),
    props: () => props, scheduleAnimation,
  });
  pointer.attach();
  const fire = (type: string, clientX: number, clientY: number, pointerId = 1) => listeners.get(type)?.({ clientX, clientY, pointerId } as PointerEvent);
  return { pointer, props, fire, listeners, canvas, scheduleAnimation };
}

describe("createBookPointer", () => {
  it("attaches and detaches the five pointer listeners", () => {
    const { pointer, listeners } = harness();
    expect([...listeners.keys()].sort()).toEqual(["pointercancel", "pointerdown", "pointerleave", "pointermove", "pointerup"]);
    pointer.detach();
    expect(listeners.size).toBe(0);
  });

  it("turns a red-pencil drag on the page into one normalized stroke", () => {
    const { pointer, props, fire, canvas, scheduleAnimation } = harness({ annotationEnabled: true });
    fire("pointerdown", 480, 300);
    expect(pointer.state.annotationPointerId).toBe(1);
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(1);
    for (let step = 1; step <= 20; step += 1) fire("pointermove", 480 + step * 6, 300 + Math.sin(step / 3) * 30);
    expect(pointer.state.annotationDraft.length).toBeGreaterThan(10);
    fire("pointerup", 600, 300);
    const stroke = vi.mocked(props.onAnnotationStroke!).mock.calls[0][0];
    expect(stroke.points.length).toBeGreaterThan(10);
    expect(stroke.points.every((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)).toBe(true);
    // The stroke went rightwards across the page, so x must increase.
    expect(stroke.points.at(-1)!.x).toBeGreaterThan(stroke.points[0].x);
    expect(pointer.state.annotationDraft).toEqual([]);
    expect(scheduleAnimation).toHaveBeenCalled();
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("reads an edge press as a page gesture and a middle press as clearing the selection", () => {
    const { props, fire } = harness();
    bookEngine.setSpread(0);
    fire("pointerdown", 760, 300);
    expect(props.onPageGesture).toHaveBeenCalledWith("forward", "start", 0);
    fire("pointermove", 600, 300);
    expect(vi.mocked(props.onPageGesture).mock.calls.at(-1)?.[1]).toBe("move");
    fire("pointerup", 600, 300);
    expect(vi.mocked(props.onPageGesture).mock.calls.at(-1)?.[1]).toBe("end");

    fire("pointerdown", 400, 300, 2);
    expect(props.onSelect).toHaveBeenCalledWith(null);
    expect(props.onPageGesture).toHaveBeenCalledTimes(3);
  });
});
