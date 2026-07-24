// lib/animations.ts
//
// Tiny wrapper around anime.js (v4) for the handful of one-off entrance
// animations used across the auth / marketing pages. Each helper targets
// a CSS selector (elements are rendered with `style={{ opacity: 0 }}` so
// there's no flash of unstyled content before the animation runs) and
// animates them in. Safe to call on the server / before elements exist —
// anime.js simply no-ops on an empty selection.

import { animate, stagger, type AnimationParams } from "animejs";

type RevealOptions = {
  /** Animation duration in ms. */
  duration?: number;
  /** Delay before the animation starts, in ms. */
  delay?: number;
  /** Delay between each matched element, in ms (for multi-element selectors). */
  staggerMs?: number;
  /** Vertical offset (px) the elements travel from while fading in. */
  y?: number;
};

const EASE_OUT = "outExpo";

/**
 * Fades + slides elements in from `y` pixels below their resting position.
 * Use for cards, form fields, headings — anything that should feel like it
 * settles into place on mount.
 */
export function revealIn(selector: string, options: RevealOptions = {}) {
  const { duration = 600, delay = 0, staggerMs = 0, y = 12 } = options;

  const targets = document.querySelectorAll(selector);
  if (!targets.length) return;

  animate(targets, {
    opacity: [0, 1],
    translateY: [y, 0],
    duration,
    delay: staggerMs ? stagger(staggerMs, { start: delay }) : delay,
    ease: EASE_OUT,
  } satisfies AnimationParams);
}

/**
 * Scales + fades an element in with a slight overshoot — used for success
 * states / confirmation badges that should feel like a small "pop".
 */
export function popIn(selector: string, options: RevealOptions = {}) {
  const { duration = 500, delay = 0, staggerMs = 0 } = options;

  const targets = document.querySelectorAll(selector);
  if (!targets.length) return;

  animate(targets, {
    opacity: [0, 1],
    scale: [0.9, 1],
    duration,
    delay: staggerMs ? stagger(staggerMs, { start: delay }) : delay,
    ease: "outBack",
  } satisfies AnimationParams);
}

/**
 * Horizontal shake — used to draw attention to inline error/validation
 * messages when they appear. Doesn't touch opacity so it works whether or
 * not the element started hidden.
 */
export function shake(selector: string, options: RevealOptions = {}) {
  const { duration = 450, delay = 0 } = options;

  const targets = document.querySelectorAll(selector);
  if (!targets.length) return;

  animate(targets, {
    translateX: [0, -8, 8, -6, 6, -3, 3, 0],
    duration,
    delay,
    ease: "outQuad",
  } satisfies AnimationParams);
}
