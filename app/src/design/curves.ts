/** One bound for every ratio, progress and normalised coordinate in the app. */
export function clamp(value: number, min: number, max: number) {
  return value < min ? min : value > max ? max : value;
}

export const clamp01 = (value: number) => clamp(value, 0, 1);

/**
 * Smootherstep, in one place.
 *
 * Zero first AND second derivative at both ends, which is why the case open
 * uses it: nothing starts, stops or lands abruptly, and there is no segment
 * join left to twitch at.
 *
 * It lives here rather than in either caller because the two halves of the
 * same gesture read it — App drives the cover's openness over the book-handoff
 * token, ThreeBook drives the travel from the shelf against that same clock. Two
 * copies of the polynomial meant retuning one desynchronised the other
 * mid-swing, which is precisely the jank the curve was chosen to remove.
 */
export function smootherstep(t: number) {
  const clamped = clamp01(t);
  return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10);
}
