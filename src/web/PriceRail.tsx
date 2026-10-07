import { useLayoutEffect, useRef, useState } from "react";
import type { MatchedListing } from "../core/match";
import { formatSgd } from "../core/price";
import { railLayout, railTicks } from "./present";

/** Width of one hanging tag, and the gap that pushes a close neighbour to the next row. */
const TAG_WIDTH = 104;
const ROW_HEIGHT = 92;
/** The peg rail's height in the track, below the ruler's numbers. */
const RAIL_Y = 22;
/** Where the first row of tags starts. */
const TOP = 40;

const SHORT_WARRANTY: Record<MatchedListing["warranty"], string> = {
  local: "Local warranty",
  export: "Export set",
  parallel_import: "Parallel import",
  unknown: "Warranty ?",
};

/**
 * Every counting listing hung on one SGD scale like shelf tags, so the spread
 * of prices and where the local-warranty units sit are visible at a glance.
 */
export function PriceRail({ listings }: { listings: MatchedListing[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const counting = listings.filter((l) => l.comparable && l.price !== null);
  if (counting.length === 0) return null;

  const usable = Math.max(0, width - TAG_WIDTH);
  const { tags, rows, min, max } = railLayout(counting, usable, TAG_WIDTH + 6);
  const cheapest = tags[0].listing;
  const cheapestLocal = tags.find((t) => t.listing.warranty === "local")?.listing;

  const ticks = railTicks(min, max, usable, Math.max(2, Math.round(usable / 110)));

  return (
    <figure className="rail">
      <div
        className={`rail-track${tags.length === 1 ? " rail-single" : ""}`}
        ref={ref}
        style={{ height: TOP + rows * ROW_HEIGHT }}
        aria-hidden="true"
      >
        {width > 0 && tags.length > 1 &&
          ticks.map((t, i) => (
            <span key={t.value} className="rail-tick" style={{ left: t.x + TAG_WIDTH / 2 }}>
              {i === 0 ? "S$" : ""}
              {Math.round(t.value)}
            </span>
          ))}
        {width > 0 &&
          tags.map(({ listing: l, x, row }, i) => (
            <div
              key={l.url}
              className={`rail-hang${l === cheapest ? " is-lowest" : ""}`}
              // Upper rows sit on top so lower tags' strings pass behind them.
              style={{ left: x, top: RAIL_Y, height: TOP - RAIL_Y + row * ROW_HEIGHT, zIndex: rows - row, animationDelay: `${i * 70}ms` }}
            >
              <div className={`tag rail-tag${l.warranty === "local" ? " is-local" : ""}`}>
                <span className="rail-price">{formatSgd(l.price)}</span>
                <span className="rail-shop">{l.source}</span>
                <span className="rail-warranty">{SHORT_WARRANTY[l.warranty]}</span>
              </div>
            </div>
          ))}
      </div>
      <figcaption>
        {tags.length === 1 ? (
          <>Only one listing counts: {formatSgd(cheapest.price)} at {cheapest.source}.</>
        ) : (
          <>
            {tags.length} listings count, from {formatSgd(min)} to {formatSgd(max)}. Cheapest is {cheapest.source}
            {cheapest.warranty !== "local" && ` (${cheapest.warranty === "unknown" ? "warranty not stated" : cheapest.warranty.replace("_", " ")})`}
            {cheapestLocal && cheapestLocal !== cheapest
              ? `; cheapest with local warranty is ${formatSgd(cheapestLocal.price)} at ${cheapestLocal.source}.`
              : cheapestLocal
                ? ", with local warranty."
                : "; none says it has local warranty."}
          </>
        )}
      </figcaption>
    </figure>
  );
}
