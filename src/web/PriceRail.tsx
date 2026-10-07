import { useLayoutEffect, useRef, useState } from "react";
import type { MatchedListing } from "../core/match";
import { formatSgd } from "../core/price";
import { railLayout } from "./present";

/** Width of one hanging tag, and the gap that pushes a close neighbour to the next row. */
const TAG_WIDTH = 104;
const ROW_HEIGHT = 74;

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

  return (
    <figure className="rail">
      <div
        className={`rail-track${tags.length === 1 ? " rail-single" : ""}`}
        ref={ref}
        style={{ height: rows * ROW_HEIGHT + 14 }}
        aria-hidden="true"
      >
        {width > 0 &&
          tags.map(({ listing: l, x, row }, i) => (
            <div
              key={l.url}
              className={`rail-tag${l.warranty === "local" ? " is-local" : ""}`}
              // Upper rows sit on top so lower tags' strings pass behind them.
              style={{ left: x, top: 14 + row * ROW_HEIGHT, zIndex: rows - row, animationDelay: `${i * 60}ms` }}
            >
              <span className="rail-string" style={{ height: 14 + row * ROW_HEIGHT }} />
              <span className="rail-price">{formatSgd(l.price)}</span>
              <span className="rail-shop">{l.source}</span>
              <span className="rail-warranty">{SHORT_WARRANTY[l.warranty]}</span>
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
