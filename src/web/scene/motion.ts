/**
 * Where each 3D price tag in the masthead is at a given moment. Pure, so the
 * choreography can be tested without WebGL: tags drop onto the rail in no
 * order, swing, then slide into price order and the lowest lights up.
 */

export type HeroTag = { shop: string; price: number };

export type Pose = { x: number; y: number; z: number; swing: number; glow: number };

export const TIMING = {
  /** Gap between one tag's drop and the next. */
  stagger: 0.11,
  drop: 0.9,
  sortAt: 1.7,
  sortFor: 1.0,
  glowAt: 2.7,
  glowFor: 0.6,
};

/** The sample shown before any search; same monitor, five shops. */
export const HERO_TAGS: HeroTag[] = [
  { shop: "challenger.sg", price: 469 },
  { shop: "shopee.sg", price: 429 },
  { shop: "dell.com/sg", price: 479 },
  { shop: "lazada.sg", price: 445 },
  { shop: "courts.com.sg", price: 459 },
];

/** Rank of each tag by price, cheapest 0. Ties keep their order. */
export function priceRanks(tags: HeroTag[]): number[] {
  const order = tags.map((t, i) => ({ p: t.price, i })).sort((a, b) => a.p - b.p || a.i - b.i);
  const ranks = new Array<number>(tags.length);
  order.forEach((o, r) => (ranks[o.i] = r));
  return ranks;
}

/** Evenly spaced slot centres across `width`, slot 0 on the left. */
export function slotX(slot: number, count: number, width: number): number {
  return count < 2 ? 0 : -width / 2 + (slot * width) / (count - 1);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeInOut = (v: number) => (v < 0.5 ? 4 * v * v * v : 1 - (-2 * v + 2) ** 3 / 2);
/** A spring settling from 1 to 0: overshoots a little, then rests. */
const settle = (v: number) => (v >= 1 ? 0 : Math.exp(-5 * v) * Math.cos(v * 9));

/**
 * Pose of tag `i` at `t` seconds. `scatter` is the order it lands in before
 * sorting; `ranks` the order it ends in. Neighbours alternate depth so close
 * tags never sit in the same plane.
 */
export function tagPose(i: number, t: number, ranks: number[], scatter: number[], width: number): Pose {
  const n = ranks.length;
  const from = slotX(scatter[i], n, width);
  const to = slotX(ranks[i], n, width);

  const dropT = clamp01((t - i * TIMING.stagger) / TIMING.drop);
  const sortT = clamp01((t - TIMING.sortAt) / TIMING.sortFor);
  const s = easeInOut(sortT);
  const x = from + (to - from) * s;

  // Falling in from above, then a damped bounce on the string.
  const y = dropT === 0 ? 4 : 4 * settle(dropT) * (1 - dropT) ** 2;
  // Swing on landing, and lag behind the slide while sorting.
  const landing = 0.5 * settle(dropT);
  const sliding = sortT > 0 && sortT < 1 ? -Math.sign(to - from) * Math.sin(sortT * Math.PI) * 0.35 : 0;
  const z = ranks[i] % 2 === 0 ? 0 : -0.45;
  const glow = ranks[i] === 0 ? clamp01((t - TIMING.glowAt) / TIMING.glowFor) : 0;
  return { x, y, z, swing: landing + sliding, glow };
}

/** Seconds until the opening sequence has come to rest. */
export function settledAt(count: number): number {
  return Math.max(TIMING.glowAt + TIMING.glowFor, (count - 1) * TIMING.stagger + TIMING.drop);
}
