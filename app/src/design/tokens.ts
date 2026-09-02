/**
 * Durations and easing points in the numeric forms their JS consumers
 * (Element.animate, the Page-turn session) require. Every CSS scale lives in
 * tokens.css.
 */
export const durationMs = {
  "feedback": 120,
  "state": 220,
  "theme": 240,
  "reveal": 320,
  "book": 1100,
  "navigation": 760
} as const;

export const easePoints = {
  "object": [
    0.22,
    1,
    0.36,
    1
  ],
  "info": [
    0.2,
    0.8,
    0.2,
    1
  ],
  "navigation": [
    0.22,
    0.72,
    0.16,
    1
  ]
} as const;
