/**
 * Where an element sits across the open spread, as a single 0…1 number.
 *
 * The mapping was written out five times — twice in App (the 2D composite's
 * `left`, and the selection ring's anchor) and three times in ThreeBook in
 * world units — so a change to the page model had to be found in five places
 * across two coordinate spaces, and the ring silently drifted off its element
 * whenever one was missed. Both spaces derive from this: the DOM multiplies by
 * a width, the scene maps 0…1 onto the spread's world extent.
 */
export function spreadFraction(element: { page: "left" | "right"; transform: { x: number } }) {
  return (element.page === "right" ? 0.5 : 0) + element.transform.x * 0.5;
}

/** A portrait reader frames one physical page; every other scene keeps the spread. */
export function readerCameraPage(
  mode: "reader" | "workshop",
  singlePage: boolean,
  selectedPage?: "left" | "right",
) {
  return mode === "reader" && singlePage ? selectedPage ?? "right" : null;
}

/** Which authored page occupies the portrait book shell; null keeps the spread. */
export function readerSinglePagePresentation(
  mode: "reader" | "workshop",
  singlePage: boolean,
  openProgress: number,
  selectedPage?: "left" | "right",
  turningForward = false,
) {
  if (mode !== "reader" || !singlePage || openProgress < 0.999) return null;
  return !turningForward && selectedPage === "left" ? "left" : "right";
}
