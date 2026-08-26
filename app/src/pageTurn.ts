export type DeformedPageVertex = {
  x: number;
  y: number;
  z: number;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

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
export function deformPageVertex(baseX: number, baseY: number, progress: number, pageWidth: number): DeformedPageVertex {
  const t = clamp01(progress);
  const distanceFromSpine = baseX + pageWidth / 2;
  const u = clamp01(distanceFromSpine / pageWidth);
  const turnAngle = Math.PI * t;
  const turnLift = Math.sin(turnAngle);
  const localCurl = turnLift * 0.36 * Math.sin(Math.PI * u);
  const localAngle = turnAngle - localCurl;

  const projectedDistance = Math.cos(localAngle) * distanceFromSpine;
  const boundedArch = turnLift * (
    0.14
    + 1.05 * Math.sin(Math.PI * u)
    + 0.26 * u
  );

  return {
    x: -pageWidth / 2 + projectedDistance,
    y: baseY,
    z: boundedArch,
  };
}
