/**
 * Smootherstep, in one place.
 *
 * Zero first AND second derivative at both ends, which is why the case open
 * uses it: nothing starts, stops or lands abruptly, and there is no segment
 * join left to twitch at.
 *
 * It lives here rather than in either caller because the two halves of the
 * same gesture read it — App drives the cover's openness over 760ms, ThreeBook
 * drives the book's travel in from the shelf against the same clock. Two
 * copies of the polynomial meant retuning one desynchronised the other
 * mid-swing, which is precisely the jank the curve was chosen to remove.
 */
export function smootherstep(t: number) {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10);
}
