/**
 * The two spring families consumed by Motion. Durations and easing points are
 * emitted separately below in the numeric forms their consumers require.
 */
export const motion = {
  "springObject": {
    "stiffness": 180,
    "damping": 26,
    "mass": 1
  },
  "springSurface": {
    "stiffness": 120,
    "damping": 24,
    "mass": 1.1
  }
} as const;

/**
 * The same two scales in the units Motion takes. Derived here rather than
 * retyped at the call sites, which is what the CSS strings above were quietly
 * forcing every JS animation to do.
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
