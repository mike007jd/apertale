import { clamp01 } from "./design/curves";

export type TurnDirection = "forward" | "backward";

type DeformedPageVertex = {
  x: number;
  y: number;
  z: number;
};

type TurnContentPlan = {
  destinationIndex: number;
  turningSpreadIndex: number;
  underlaySpreadIndex: number;
};

/**
 * The cover and illustrated front matter share one physical opening arc. Their
 * local x axes point in opposite directions, so the cover uses a negative
 * rotation and the matter a positive one: both must rise toward the camera at
 * mid-swing instead of diving through the static page block.
 */
export function bookCaseMatterPose(openProgress: number, flatPhi: number) {
  const openness = clamp01(openProgress);
  const phi = flatPhi + (1 - openness) * (Math.PI - flatPhi);
  return {
    coverY: openness === 0 ? 0 : -(Math.PI - flatPhi) * openness,
    foldY: openness === 1 ? 0 : Math.PI * (1 - openness),
    reliefZ: 0.08 + 0.92 * openness,
    closure: (1 - Math.cos(phi)) / 2,
  };
}

/** Keeps the flexible spine between the fixed rear hinge and moving front hinge. */
export function bookSpinePose(
  rear: { x: number; z: number },
  front: { x: number; z: number },
  openWidth: number,
) {
  const dx = rear.x - front.x;
  const dz = rear.z - front.z;
  return {
    x: (rear.x + front.x) / 2,
    z: (rear.z + front.z) / 2,
    rotationY: -Math.atan2(dz, dx),
    scale: Math.hypot(dx, dz) / openWidth,
  };
}

/** Places the book group while its front-cover center travels between shelf and reader. */
export function caseHandoffGroupX(
  anchorCenterX: number,
  scale: number,
  coverCenterX: number,
  settledCoverCenterX: number,
  travel: number,
) {
  const desiredCoverCenterX = anchorCenterX + (settledCoverCenterX - anchorCenterX) * travel;
  return desiredCoverCenterX - scale * coverCenterX;
}

/**
 * Resolves which spread is painted onto the moving leaf and which spread stays
 * physically underneath it. Keeping this explicit prevents the renderer from
 * dropping illustrated content while the document index is still unchanged.
 */
export function resolveTurnContentPlan(
  currentIndex: number,
  direction: TurnDirection,
  spreadCount: number,
): TurnContentPlan | null {
  const destinationIndex = currentIndex + (direction === "forward" ? 1 : -1);
  if (destinationIndex < 0 || destinationIndex >= spreadCount) return null;
  return {
    destinationIndex,
    turningSpreadIndex: direction === "forward" ? currentIndex : destinationIndex,
    underlaySpreadIndex: direction === "forward" ? destinationIndex : currentIndex,
  };
}

/**
 * Shared resting profile for both the open paper and a leaf at either end of a
 * turn. Keeping this in one place prevents the first animation frame from
 * snapping from a curved page to a flat sheet.
 */
export function restingPageDepth(baseX: number, baseY: number, pageWidth: number, pageHeight: number) {
  const u = clamp01((baseX + pageWidth / 2) / pageWidth);
  const arch = Math.sin(Math.PI * u) * 0.17;
  const outerLift = Math.pow(u, 5) * 0.055;
  const cornerLift = Math.pow(Math.abs(baseY) / (pageHeight / 2), 7) * 0.025;
  return arch + outerLift + cornerLift;
}

/**
 * Keeps the active leaf inside the physical scale of the open book.
 *
 * Rotating every vertex around the spine by its full distance produces a
 * physically literal sheet, but it also sends the outer edge several world
 * units toward a perspective camera. The page then balloons beyond the cover
 * at mid-turn. This curve preserves the horizontal fold while using a bounded
 * paper arch for depth, which reads like a cinematic page curl from the fixed
 * editor camera.
 */
export function deformPageVertex(
  baseX: number,
  baseY: number,
  progress: number,
  pageWidth: number,
  pageHeight = pageWidth * (5.18 / 4.2),
): DeformedPageVertex {
  const t = clamp01(progress);
  const distanceFromSpine = baseX + pageWidth / 2;
  const u = clamp01(distanceFromSpine / pageWidth);
  const turnAngle = Math.PI * t;
  const turnLift = Math.sin(turnAngle);
  const curl = Math.sin(Math.PI * u);
  const projectedDistance = Math.cos(turnAngle) * distanceFromSpine;
  const restingDepth = restingPageDepth(baseX, baseY, pageWidth, pageHeight);
  // Preserve a readable crescent at the midpoint. Returning the outer edge to
  // the spine collapsed the projected page into a razor-thin strip and made
  // its triangles and shadow read as a torn sheet.
  const sidewaysCurl = turnLift * pageWidth * (0.11 * u + 0.1 * curl);
  const boundedArch = turnLift * (
    0.12
    + 0.94 * curl
    + 0.2 * u
  );

  return {
    x: -pageWidth / 2 + projectedDistance + sidewaysCurl,
    y: baseY,
    z: restingDepth + boundedArch,
  };
}
