/**
 * Everything drawn onto the paper with the 2D canvas API before it becomes a
 * texture: the illustrated background crop, the typeset left page, and the
 * workshop's pencil storyboard with the reader's red marks. No WebGL, no
 * React, so it runs under a stubbed 2D context in tests.
 */
import * as THREE from "three";
import { acquireAssetPreviewUrl, acquireAssetUrl } from "./assetStore";
import { clamp01 } from "./design/curves";
import { PAGE_H, PAGE_W } from "./bookGeometry";
import { centeredContainPlacement, centeredCoverCrop } from "./imageCrop";
import type { StoryboardMark, StoryboardPoint, StoryboardSpread } from "./storyboard";
import { spreadArtworkFit, spreadBaseAssetId, type Spread } from "./types";

export type PagePair = {
  spread: THREE.CanvasTexture;
  overlay: THREE.CanvasTexture;
};

/** Per-mark reveal budget: a six-mark spread draws in about half a second, a full one in 2.4 s. */
export const MARK_REVEAL_MS = 90;
export const MAX_REVEAL_MS = 2400;

const PENCIL = "rgba(64, 58, 50, .82)";
const RED_PENCIL = "rgba(230, 74, 61, .94)";
const HAND_FONT = "\"Marker Felt\", \"Chalkboard SE\", \"Bradley Hand\", \"Segoe Print\", \"Comic Sans MS\", cursive";
const LABEL_PX = { s: 36, m: 48, l: 64 } as const;
const MARK_LABEL_PX = 34;

/** Reader photos ghosted into storyboard boxes; `null` while loading or after a silent failure. */
const sketchImages = new Map<string, HTMLImageElement | null>();
let sketchImageVersion = 0;
/** Bumps once per ghost that finishes loading, so a paint keyed on it repaints once more. */
export const getSketchImageVersion = () => sketchImageVersion;

function sketchImage(assetId: string) {
  if (sketchImages.has(assetId)) return sketchImages.get(assetId);
  sketchImages.set(assetId, null);
  // ponytail: leases live for the page; bounded by the reader's source photos, release on storyboard reset if it ever matters.
  acquireAssetPreviewUrl(assetId).then(async (lease) => {
    const image = new Image();
    image.decoding = "async";
    image.src = lease.url;
    await image.decode();
    sketchImages.set(assetId, image);
    sketchImageVersion += 1;
  }).catch(() => undefined);
  return null;
}

/** A deterministic wobble so a pencil line never reads as a vector rule, and never jitters between frames. */
const wobble = (seed: number, index: number) => Math.sin(seed * 12.9898 + index * 1.7) * 1.4;

function tracePath(context: CanvasRenderingContext2D, points: readonly StoryboardPoint[], progress = 1, seed = 0) {
  const visible = Math.max(0, Math.min(points.length, Math.ceil(points.length * progress)));
  if (visible < 2) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < visible; index += 1) {
    context.lineTo(points[index].x + wobble(seed, index), points[index].y + wobble(seed + 1, index));
  }
  context.stroke();
}

const px = (point: StoryboardPoint, width: number, height: number) => ({ x: point.x * width, y: point.y * height });

/** The pencil path of a mark in canvas pixels; labels have no path. */
function markPath(mark: StoryboardMark, width: number, height: number): StoryboardPoint[] {
  switch (mark.kind) {
    case "line": return mark.points.map((point) => px(point, width, height));
    case "rect": {
      const l = mark.x * width; const t = mark.y * height; const r = (mark.x + mark.w) * width; const b = (mark.y + mark.h) * height;
      // Corners overshoot by a few pixels, the way a quick pencil box does.
      return [{ x: l - 4, y: t }, { x: r + 5, y: t }, { x: r, y: t - 4 }, { x: r, y: b + 5 }, { x: r + 4, y: b }, { x: l - 5, y: b }, { x: l, y: b + 4 }, { x: l, y: t - 6 }];
    }
    case "ellipse": {
      const cx = (mark.x + mark.w / 2) * width; const cy = (mark.y + mark.h / 2) * height;
      const rx = mark.w / 2 * width; const ry = mark.h / 2 * height;
      return Array.from({ length: 44 }, (_, index) => {
        const angle = -Math.PI / 2 + (index / 40) * Math.PI * 2;
        return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
      });
    }
    case "arrow": {
      const from = px(mark.from, width, height); const to = px(mark.to, width, height);
      const mid = { x: (from.x + to.x) / 2 + (to.y - from.y) * 0.04, y: (from.y + to.y) / 2 - (to.x - from.x) * 0.04 };
      return [from, mid, to];
    }
    case "label": return [];
  }
}

function paintArrowHead(context: CanvasRenderingContext2D, from: StoryboardPoint, to: StoryboardPoint) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const size = 22;
  context.beginPath();
  context.moveTo(to.x - Math.cos(angle - 0.5) * size, to.y - Math.sin(angle - 0.5) * size);
  context.lineTo(to.x, to.y);
  context.lineTo(to.x - Math.cos(angle + 0.5) * size, to.y - Math.sin(angle + 0.5) * size);
  context.stroke();
}

function paintMark(context: CanvasRenderingContext2D, mark: StoryboardMark, width: number, height: number, progress: number, seed: number) {
  if (progress <= 0) return;
  if (mark.kind === "label") {
    context.save();
    context.globalAlpha = progress;
    context.font = `${LABEL_PX[mark.size ?? "m"]}px ${HAND_FONT}`;
    context.textBaseline = "top";
    context.fillText(mark.text, mark.x * width, mark.y * height);
    context.restore();
    return;
  }
  const path = markPath(mark, width, height);
  const ghost = mark.kind === "rect" && mark.assetId ? sketchImage(mark.assetId) : null;
  if (ghost && mark.kind === "rect") {
    const l = mark.x * width; const t = mark.y * height; const w = mark.w * width; const h = mark.h * height;
    const crop = centeredCoverCrop(ghost.naturalWidth, ghost.naturalHeight, w / h);
    context.save();
    context.globalAlpha = 0.4 * progress;
    context.filter = "grayscale(1) contrast(1.35)";
    context.drawImage(ghost, crop.x, crop.y, crop.width, crop.height, l, t, w, h);
    context.restore();
  }
  tracePath(context, path, progress, seed);
  if (progress < 1) return;
  if (mark.kind === "arrow") paintArrowHead(context, path[1], path[2]);
  if (mark.label) {
    const anchor = mark.kind === "arrow" ? path[1] : path[0];
    context.save();
    context.font = `${MARK_LABEL_PX}px ${HAND_FONT}`;
    context.textBaseline = "bottom";
    context.fillText(mark.label, anchor.x + 6, anchor.y - 6);
    context.restore();
  }
}

/**
 * Repaints the workshop overlay: Codex's marks revealed in order, then the
 * reader's red marks, then the stroke being drawn right now.
 */
export function paintWorkshopDrawing(
  pair: PagePair,
  spread: StoryboardSpread | undefined,
  draft: readonly StoryboardPoint[],
  sketchProgress: number,
) {
  const canvas = pair.overlay.image as HTMLCanvasElement | undefined;
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return;
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  paintSketch(context, spread, width, height, sketchProgress);
  if (draft.length >= 2) {
    context.strokeStyle = RED_PENCIL;
    context.lineWidth = 8;
    tracePath(context, draft.map((point) => px(point, width, height)));
  }
  pair.overlay.needsUpdate = true;
}

function paintSketch(context: CanvasRenderingContext2D, spread: StoryboardSpread | undefined, width: number, height: number, sketchProgress: number) {
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = PENCIL;
  context.fillStyle = PENCIL;
  context.lineWidth = 6.5;
  const marks = spread?.marks ?? [];
  marks.forEach((mark, index) => paintMark(context, mark, width, height, clamp01(sketchProgress * marks.length - index), index + 1));
  context.strokeStyle = RED_PENCIL;
  context.lineWidth = 8;
  spread?.annotations.forEach((stroke) => tracePath(context, stroke.points.map((point) => px(point, width, height))));
}

/**
 * The created book's first spread wears its own pencil plan for a moment:
 * the finished overlay (typeset text) is restored from `base`, then the
 * sketch is drawn over it at `alpha`. Alpha 0 leaves the overlay as loaded.
 */
export function paintSketchFade(pair: PagePair, spread: StoryboardSpread, base: HTMLCanvasElement, alpha: number) {
  const canvas = pair.overlay.image as HTMLCanvasElement | undefined;
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return;
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  context.drawImage(base, 0, 0);
  if (alpha > 0) {
    context.save();
    context.globalAlpha = alpha;
    paintSketch(context, spread, width, height, 1);
    context.restore();
  }
  pair.overlay.needsUpdate = true;
}

/** A copy of the overlay as loaded, so the fade can put it back untouched. */
export function snapshotOverlay(pair: PagePair): HTMLCanvasElement | null {
  const source = pair.overlay.image as HTMLCanvasElement | undefined;
  if (!source) return null;
  const copy = document.createElement("canvas");
  copy.width = source.width;
  copy.height = source.height;
  copy.getContext("2d")?.drawImage(source, 0, 0);
  return copy;
}

/**
 * Splitting on the ASCII space is only line breaking for scripts that use one.
 * A Chinese, Japanese or Thai body produced a single token, so the whole
 * paragraph became one unbreakable line that ran off the bottom of the page.
 * Intl.Segmenter knows where each script actually allows a break.
 */
const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });

function segmentsOf(text: string): string[] {
  return [...segmenter.segment(text)].map((entry) => entry.segment);
}

export function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let line = "";
  for (const piece of segmentsOf(text)) {
    // A break opportunity at the start of a line would leave the line empty,
    // so a single over-long segment is allowed to overhang rather than loop.
    const test = line + piece;
    if (line && context.measureText(test).width > maxWidth) {
      lines.push(line.trimEnd());
      line = piece.trimStart();
      continue;
    }
    line = test;
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines.length ? lines : [""];
}

export function sampleCanvasLuminance(context: CanvasRenderingContext2D) {
  const samples = context.getImageData(96, 110, 600, 900).data;
  let weighted = 0;
  let count = 0;
  for (let index = 0; index < samples.length; index += 4 * 64) {
    weighted += samples[index] * 0.2126 + samples[index + 1] * 0.7152 + samples[index + 2] * 0.0722;
    count += 1;
  }
  return count > 0 ? weighted / count : 255;
}

function createPageBackgroundCanvas(
  image: HTMLImageElement | null,
  side: "left" | "right",
  fit: "cover" | "contain",
) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1264;
  const context = canvas.getContext("2d");
  if (!context) return canvas;

  if (image) {
    if (fit === "contain") {
      // Preserved-photo layouts promise source geometry, so show the complete
      // layout on paper instead of silently cropping a reader-owned original.
      context.fillStyle = "#f7efdf";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const placement = centeredContainPlacement(
        image.naturalWidth,
        image.naturalHeight,
        canvas.width * 2,
        canvas.height,
      );
      context.save();
      context.translate(side === "left" ? 0 : -canvas.width, 0);
      context.drawImage(image, placement.x, placement.y, placement.width, placement.height);
      context.restore();
    } else {
      // Crop the full illustration once in spread coordinates, then give each
      // page exactly half. Mapping either raw half directly onto the page would
      // squash every source whose aspect differs from the physical stage.
      const crop = centeredCoverCrop(image.naturalWidth, image.naturalHeight, (PAGE_W * 2) / PAGE_H);
      const sourceWidth = crop.width / 2;
      const sourceX = crop.x + (side === "left" ? 0 : sourceWidth);
      context.drawImage(image, sourceX, crop.y, sourceWidth, crop.height, 0, 0, canvas.width, canvas.height);
    }
  } else {
    // Warm uncoated paper fallback for books that have not received a generated
    // full-spread illustration yet.
    const wash = context.createLinearGradient(0, 0, side === "left" ? canvas.width : 0, canvas.height);
    wash.addColorStop(0, "#fbf5e7");
    wash.addColorStop(1, "#f0e6d1");
    context.fillStyle = wash;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

function createPageOverlayCanvas(background: HTMLCanvasElement, spread: Spread, side: "left" | "right", illustrated: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = background.width;
  canvas.height = background.height;
  const context = canvas.getContext("2d");
  const backgroundContext = background.getContext("2d");
  if (!context || !backgroundContext) return canvas;

  if (side === "left") {
    const darkSpread = illustrated && sampleCanvasLuminance(backgroundContext) < 126;
    context.save();
    context.fillStyle = darkSpread ? "rgba(244, 232, 203, .95)" : "rgba(18, 20, 18, .96)";
    context.textBaseline = "top";
    let top = 190;

    context.font = `${darkSpread ? 72 : 76}px Georgia, serif`;
    const titleLines = wrapText(context, spread.title, 620);

    /**
     * The body used to be authored at 31px, which lands at under 15 CSS px on
     * the primary canvas with no resolution headroom. It is set at 56px now,
     * and steps down only as far as it must to stay on the page - the old code
     * had no clamp at all, so an 800-character body simply ran off the bottom.
     */
    const bodyTop = 190 + titleLines.length * 86 + 44;
    const bodyRoom = canvas.height - bodyTop - 150;
    let bodySize = 56;
    let bodyLines: string[] = [];
    for (;;) {
      context.font = `${bodySize}px Avenir Next, Arial, sans-serif`;
      bodyLines = wrapText(context, spread.body, 560);
      if (bodyLines.length * (bodySize * 1.46) <= bodyRoom || bodySize <= 34) break;
      bodySize -= 3;
    }
    const bodyLeading = bodySize * 1.46;
    const bodyFits = Math.max(1, Math.floor(bodyRoom / bodyLeading));
    if (bodyLines.length > bodyFits) bodyLines = bodyLines.slice(0, bodyFits);

    if (illustrated) {
      /**
       * This used to be a rounded rectangle with a hard edge - a card drawn on
       * the paper, with the story written inside the card. Print does not do
       * that: it lays a wash into the sheet and sets the type in it, so the
       * page reads as one surface. Two gradients, no border, nothing to catch
       * the eye as an edge.
       */
      const across = context.createLinearGradient(0, 0, 880, 0);
      across.addColorStop(0, darkSpread ? "rgba(9, 14, 13, .94)" : "rgba(255, 251, 242, .90)");
      across.addColorStop(0.72, darkSpread ? "rgba(9, 14, 13, .78)" : "rgba(255, 251, 242, .66)");
      across.addColorStop(1, darkSpread ? "rgba(9, 14, 13, 0)" : "rgba(255, 251, 242, 0)");
      context.fillStyle = across;
      context.fillRect(0, 0, 880, canvas.height);

      const down = context.createLinearGradient(0, 0, 0, canvas.height);
      down.addColorStop(0, darkSpread ? "rgba(9, 14, 13, .18)" : "rgba(255, 251, 242, .22)");
      down.addColorStop(0.34, "rgba(0, 0, 0, 0)");
      down.addColorStop(0.72, "rgba(0, 0, 0, 0)");
      down.addColorStop(1, darkSpread ? "rgba(9, 14, 13, .16)" : "rgba(255, 251, 242, .2)");
      context.fillStyle = down;
      context.fillRect(0, 0, canvas.width, canvas.height);

      context.fillStyle = darkSpread ? "rgba(244, 232, 203, .96)" : "rgba(18, 20, 18, .96)";
    }

    if (spread.kicker) {
      context.font = "28px Avenir Next, Arial, sans-serif";
      context.globalAlpha = 0.62;
      context.fillText(spread.kicker.toUpperCase(), 112, top - 66);
      context.globalAlpha = 1;
    }

    context.font = `${darkSpread ? 72 : 76}px Georgia, serif`;
    titleLines.forEach((titleLine, index) => context.fillText(titleLine, 112, top + index * 84));
    context.font = `${bodySize}px Avenir Next, Arial, sans-serif`;
    context.globalAlpha = 0.88;
    top = bodyTop;
    bodyLines.forEach((bodyLine, index) => context.fillText(bodyLine, 114, top + index * bodyLeading));

    if (!illustrated) {
      const rule = top + bodyLines.length * bodyLeading + 46;
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

export async function loadPagePairs(spreads: Spread[], mode: "reader" | "workshop") {
  const entries = await Promise.all(
    spreads.map(async (spread) => {
      const baseAssetId = spreadBaseAssetId(spread);
      const artworkLease = baseAssetId ? await acquireAssetUrl(baseAssetId) : undefined;
      try {
        let image: HTMLImageElement | null = null;
        if (artworkLease) {
          image = new Image();
          image.decoding = "async";
          image.src = artworkLease.url;
          await image.decode();
        }
        const fit = spreadArtworkFit(spread);
        const leftCanvas = createPageBackgroundCanvas(image, "left", fit);
        const rightCanvas = createPageBackgroundCanvas(image, "right", fit);
        const leftOverlay = mode === "workshop"
          ? document.createElement("canvas")
          : createPageOverlayCanvas(leftCanvas, spread, "left", Boolean(image));
        const rightOverlay = mode === "workshop"
          ? document.createElement("canvas")
          : createPageOverlayCanvas(rightCanvas, spread, "right", Boolean(image));
        if (mode === "workshop") {
          leftOverlay.width = rightOverlay.width = leftCanvas.width;
          leftOverlay.height = rightOverlay.height = leftCanvas.height;
        }
        const spreadCanvas = document.createElement("canvas");
        spreadCanvas.width = leftCanvas.width + rightCanvas.width;
        spreadCanvas.height = leftCanvas.height;
        const spreadContext = spreadCanvas.getContext("2d");
        spreadContext?.drawImage(leftCanvas, 0, 0);
        spreadContext?.drawImage(rightCanvas, leftCanvas.width, 0);
        const spreadTexture = new THREE.CanvasTexture(spreadCanvas);
        spreadTexture.colorSpace = THREE.SRGBColorSpace;
        spreadTexture.anisotropy = 8;
        spreadTexture.needsUpdate = true;
        const overlayCanvas = document.createElement("canvas");
        overlayCanvas.width = spreadCanvas.width;
        overlayCanvas.height = spreadCanvas.height;
        const overlayContext = overlayCanvas.getContext("2d");
        overlayContext?.drawImage(leftOverlay, 0, 0);
        overlayContext?.drawImage(rightOverlay, leftOverlay.width, 0);
        const overlayTexture = new THREE.CanvasTexture(overlayCanvas);
        overlayTexture.colorSpace = THREE.SRGBColorSpace;
        overlayTexture.anisotropy = 8;
        overlayTexture.needsUpdate = true;
        return [spread.id, { spread: spreadTexture, overlay: overlayTexture }] as const;
      } finally {
        artworkLease?.release();
      }
    }),
  );
  return new Map<string, PagePair>(entries);
}

