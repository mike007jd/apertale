/**
 * The two things every reader surface needs before it can render a book.
 *
 * Both were copy-pasted between App and SharedBookApp, `announce` byte for
 * byte including its comment. A shared book that phrases its own status
 * differently from the editor is a bug no test would catch, because both
 * copies are individually correct.
 */

/**
 * Live-region text. Screen readers run adjacent phrases together, so each part
 * is given terminal punctuation before they are joined — without it "Lifted"
 * and "Spread 3 of 12" are announced as one run-on sentence.
 */
export function announce(...parts: Array<string | undefined | null>) {
  return parts
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .map((part) => (/[.!?…:;]$/u.test(part) ? part : `${part}.`))
    .join(" ");
}

/**
 * Whether the 3D stage can run at all. `force` is the `?fallback=1` escape
 * hatch the editor exposes for capturing the 2D path; a shared book has no
 * such switch and passes nothing.
 */
export function supportsWebGl2(force = false) {
  if (force) return false;
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}
