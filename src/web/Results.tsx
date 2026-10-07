import { useEffect, useState } from "react";
import type { ItemState, ProductResult } from "../worker/agents/item";
import type { MatchedListing } from "../core/match";
import { MAX_PICKS } from "../core/request";
import { DEFAULT_CALLS_PER_RUN } from "../core/quota";
import { formatSgd } from "../core/price";
import { describeMatch, describeUnit, productName, whyNotCounted } from "./present";
import { PriceRail } from "./PriceRail";
import type { Actions } from "./App";

export function Results({ state, actions }: { state: ItemState; actions: Actions }) {
  if (state.status === "idle") {
    return (
      <div className="empty">
        <h2>Start with what you want to buy</h2>
        <p>
          Name the model if you know it. If you only know the kind of product, you'll get a few models to choose from
          first. Either way, the agent searches Singapore shops and sorts the listings by how sure it is they are the
          same item.
        </p>
      </div>
    );
  }

  return (
    <>
      <Status state={state} />
      {state.mode === "category" && state.candidates && (
        <Candidates state={state} actions={actions} />
      )}
      {state.products.map((p) => (
        <Product key={p.key} result={p} showStatus={state.products.length > 1} />
      ))}
      {state.trace.length > 0 && <RunLog state={state} />}
    </>
  );
}

function Elapsed({ from, to }: { from: number; to: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (to) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [to]);
  const s = Math.max(0, Math.round(((to ?? now) - from) / 1000));
  return <>{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}</>;
}

function Status({ state }: { state: ItemState }) {
  return (
    <div className={`status status-${state.status}`}>
      <p>
        <strong>{state.phase}</strong>
        {state.startedAt && (
          <span className="elapsed">
            {state.status === "running" ? " for " : ", took "}
            <Elapsed from={state.startedAt} to={state.finishedAt} />
          </span>
        )}
      </p>
      {state.error && <p className="warn">{state.error}</p>}
    </div>
  );
}

function Candidates({ state, actions }: { state: ItemState; actions: Actions }) {
  const [picked, setPicked] = useState<number[]>(state.picked);
  const [notice, setNotice] = useState<string | null>(null);
  const candidates = state.candidates ?? [];
  const locked = state.status === "running";
  const left = state.quotaLeft ? state.quotaLeft.firecrawl : null;

  useEffect(() => setPicked(state.picked), [state.picked]);

  function toggle(i: number) {
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length < MAX_PICKS ? [...p, i] : p));
  }

  async function compare() {
    setNotice(await actions.compare(picked));
  }

  return (
    <section className="candidates" aria-labelledby="candidates-title">
      <h2 id="candidates-title">Models that fit “{state.input?.query}”</h2>
      <p className="quiet">
        Pick up to {MAX_PICKS} to compare across shops. Each one uses up to {DEFAULT_CALLS_PER_RUN} searches
        {left !== null && `; ${left} left today`}.
      </p>
      <ul>
        {candidates.map((c, i) => {
          const checked = picked.includes(i);
          const full = !checked && picked.length >= MAX_PICKS;
          return (
            <li key={i} className={checked ? "picked" : ""}>
              <label>
                <input type="checkbox" checked={checked} disabled={locked || full} onChange={() => toggle(i)} />
                <span className="candidate-name">
                  {c.brand} {c.name}
                  {c.modelNumber && !c.name.includes(c.modelNumber) && <span className="model"> {c.modelNumber}</span>}
                </span>
                <span className="candidate-reason">{c.reason}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={compare} disabled={locked || picked.length === 0}>
        {picked.length < 2 ? "Compare across shops" : `Compare these ${picked.length}`}
      </button>
      {notice && (
        <p className="warn" role="alert">
          {notice}
        </p>
      )}
    </section>
  );
}

function Product({ result: r, showStatus }: { result: ProductResult; showStatus: boolean }) {
  const g = r.groups;
  const all = g ? [...g.matched, ...g.variants] : [];
  const counting = all.filter((l) => l.comparable);
  const name = r.product ? productName(r.product) : r.query;

  return (
    <section className="product" aria-label={name}>
      <header className="product-head">
        <h2>{name}</h2>
        <p className="quiet">
          {r.status === "running" && `${r.phase}…`}
          {r.status === "error" && <span className="warn">{r.error}</span>}
          {r.status === "done" &&
            [
              r.product?.modelNumber ? `Model ${r.product.modelNumber}` : "No model number, so listings were matched by name",
              `found in ${r.matchedSources} shop${r.matchedSources === 1 ? "" : "s"}`,
              showStatus && r.finishedAt ? `took ${Math.round((r.finishedAt - r.startedAt) / 1000)}s` : null,
            ]
              .filter(Boolean)
              .join(", ") + "."}
        </p>
      </header>

      {g && (
        <>
          <PriceRail listings={all} />
          <Group n={1} title="Same item" listings={g.matched} />
          <Group n={2} title="Other colours and sizes" listings={g.variants} />
          <Group n={3} title="Not confirmed" note="The listing doesn't say enough to be sure. Check it before buying." listings={g.unconfirmed} />
          <Group n={4} title="Different products" note="Similar names, different models." listings={g.different} collapsed />
          {counting.length === 0 && all.length > 0 && (
            <p className="quiet">None of these listings count toward the comparison; each says why below its price.</p>
          )}
        </>
      )}
    </section>
  );
}

function Group({ n, title, note, listings, collapsed }: { n: number; title: string; note?: string; listings: MatchedListing[]; collapsed?: boolean }) {
  if (listings.length === 0) return null;
  const body = (
    <>
      {note && <p className="quiet">{note}</p>}
      <ul className="listings">
        {listings.map((l) => (
          <Listing key={l.url} listing={l} />
        ))}
      </ul>
    </>
  );
  if (collapsed) {
    return (
      <details className="group">
        <summary>
          <h3>
            <span className="step">0{n}</span>
            {title} <span className="count">{listings.length}</span>
          </h3>
        </summary>
        {body}
      </details>
    );
  }
  return (
    <section className="group">
      <h3>
        <span className="step">0{n}</span>
        {title} <span className="count">{listings.length}</span>
      </h3>
      {body}
    </section>
  );
}

function Listing({ listing: l }: { listing: MatchedListing }) {
  const why = whyNotCounted(l);
  return (
    <li className={`listing ${l.comparable ? "counts" : "shown"}`}>
      <div className="price">
        <span className="amount">{l.currency === "SGD" || l.currency === null ? formatSgd(l.price) : l.priceText}</span>
        {l.originalPrice && <s aria-label={`was ${formatSgd(l.originalPrice)}`}>{formatSgd(l.originalPrice)}</s>}
        <span className="counted">{why ? `Not counted: ${why}` : "Counts"}</span>
      </div>
      <div className="listing-body">
        <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="shop">
          {l.source}
        </a>
        <p className="title">{l.title}</p>
        <p className="facts">
          {describeUnit(l)} {describeMatch(l)}
        </p>
        {(l.shippingText || l.vouchers.length > 0) && (
          <p className="extras">
            {l.shippingText && <span>Shipping: {l.shippingText}</span>}
            {l.vouchers.map((v) => (
              <span key={v}>Voucher: {v}</span>
            ))}
          </p>
        )}
      </div>
    </li>
  );
}

const AGENT: Record<string, string> = { discovery: "Price search", matcher: "Matcher", candidates: "Model finder" };

function RunLog({ state }: { state: ItemState }) {
  const tools = state.trace.filter((e) => e.kind === "tool" && !e.detail.startsWith("refused")).length;
  const names = new Map(state.products.map((p) => [p.key, p.product ? productName(p.product) : p.query]));
  return (
    <details className="runlog">
      <summary>
        Run log: {tools} tool call{tools === 1 ? "" : "s"} in the last {state.trace.length} steps
      </summary>
      <ol>
        {state.trace.map((e, i) => (
          <li key={i} className={e.ok ? "" : "fail"}>
            <span className="at">{(e.at / 1000).toFixed(1)}s</span>
            <span className="who">
              {AGENT[e.agent] ?? e.agent}
              {e.item && names.size > 1 && `, ${names.get(e.item) ?? e.item}`}
            </span>
            <span className="what">
              {e.name}: {e.detail}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
