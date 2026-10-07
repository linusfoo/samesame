import { useEffect, useState, type FormEvent } from "react";
import { useAgent } from "agents/react";
import type { ItemAgent, ItemState } from "../worker/agents/item";
import type { MatchedListing } from "../core/match";
import { formatSgd } from "../core/price";

const ITEM_KEY = "buying-helper:item";

function itemId(): string {
  try {
    const existing = localStorage.getItem(ITEM_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(ITEM_KEY, id);
    return id;
  } catch {
    return "default";
  }
}

export function App() {
  const [id] = useState(itemId);
  const [state, setState] = useState<ItemState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const agent = useAgent<ItemAgent, ItemState>({
    agent: "item-agent",
    name: id,
    onStateUpdate: (s) => setState(s),
  });

  const running = state?.status === "running";

  async function start(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setNotice(null);
    const res = await agent.stub.startResearch({
      query: String(form.get("query") ?? ""),
      description: String(form.get("description") ?? ""),
      priorities: String(form.get("priorities") ?? ""),
    });
    if (!res.started) setNotice(`Couldn't start: ${res.reason}.`);
  }

  return (
    <div className="page">
      <header className="masthead">
        <h1>Buying Helper</h1>
        <p>Finds one product across Singapore shops and shows which listings are really the same item.</p>
      </header>

      <div className="layout">
        <aside className="panel">
          <form onSubmit={start} className="ask">
            <label>
              Product
              <input name="query" required placeholder="Sony WH-1000XM6 headphones" defaultValue={state?.input?.query} />
            </label>
            <label>
              Description
              <input name="description" placeholder="Black, over-ear" defaultValue={state?.input?.description} />
            </label>
            <label>
              What matters to you
              <textarea name="priorities" rows={3} placeholder="Local warranty, under S$500" defaultValue={state?.input?.priorities} />
            </label>
            <button type="submit" disabled={running}>
              {running ? "Searching…" : "Find listings"}
            </button>
            {notice && <p className="notice" role="alert">{notice}</p>}
          </form>
          {state && <Sources state={state} />}
        </aside>

        <main className="results" aria-live="polite">
          {state ? <Results state={state} /> : <p className="quiet">Connecting…</p>}
        </main>
      </div>
    </div>
  );
}

function Sources({ state }: { state: ItemState }) {
  const c = state.sourcesConfigured;
  const missing = [
    !c.llm && "OPENCODE_API_KEY",
    !c.brave && "BRAVE_API_KEY",
    !c.tavily && "TAVILY_API_KEY",
    !c.browser && "CF_ACCOUNT_ID + CF_BROWSER_TOKEN",
  ].filter(Boolean);
  const left = state.quotaLeft;
  return (
    <div className="sources">
      {left && (
        <p>
          Left today: {left.brave} Brave searches, {left.tavily} Tavily calls, {left.browser} browser pages.
        </p>
      )}
      {missing.length > 0 && <p className="notice">Not configured: {missing.join(", ")}. Add them to .dev.vars.</p>}
    </div>
  );
}

function Elapsed({ from, to }: { from: number; to: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (to) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [to]);
  const s = Math.round(((to ?? now) - from) / 1000);
  return <>{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}</>;
}

function Results({ state }: { state: ItemState }) {
  if (state.status === "idle") {
    return (
      <div className="empty">
        <h2>Start with one product</h2>
        <p>Type its name and anything that matters to you. The agent searches Singapore shops, then groups the listings by how sure it is they are the same item.</p>
      </div>
    );
  }

  const g = state.groups;
  return (
    <>
      <div className={`status status-${state.status}`}>
        <strong>{state.phase}</strong>
        {state.startedAt && (
          <span>
            <Elapsed from={state.startedAt} to={state.finishedAt} />
          </span>
        )}
        {state.error && <p>{state.error}</p>}
      </div>

      {state.product && (
        <div className="product">
          <h2>
            {state.product.brand} {state.product.name}
          </h2>
          <p>
            {state.product.modelNumber ? `Model ${state.product.modelNumber}` : "No model number found; the LLM matched listings by name."}
            {state.status === "done" && ` Found in ${state.matchedSources} shop${state.matchedSources === 1 ? "" : "s"}.`}
          </p>
        </div>
      )}

      {g && (
        <>
          <Group title="Same item" note="Matched by model number, or by the LLM with high confidence." listings={g.matched} tone="match" />
          <Group title="Other variants" note="Same product in another colour, storage or size." listings={g.variants} tone="variant" />
          <Group title="Not confirmed" note="Couldn't tell from the listing. Check before buying." listings={g.unconfirmed} tone="unsure" />
          <Group title="Different products" note="Similar names, different models." listings={g.different} tone="different" />
        </>
      )}

      {state.trace.length > 0 && <RunLog state={state} />}
    </>
  );
}

function Group({ title, note, listings, tone }: { title: string; note: string; listings: MatchedListing[]; tone: string }) {
  if (listings.length === 0) return null;
  return (
    <section className={`group group-${tone}`}>
      <h3>
        {title} <span className="count">{listings.length}</span>
      </h3>
      <p className="quiet">{note}</p>
      <ul className="tags">
        {listings.map((l) => (
          <Tag key={l.url} listing={l} />
        ))}
      </ul>
    </section>
  );
}

const WARRANTY: Record<string, string> = {
  local: "Local warranty",
  export: "Export set",
  parallel_import: "Parallel import",
  unknown: "Warranty unknown",
};

function Tag({ listing: l }: { listing: MatchedListing }) {
  const how =
    l.status === "same" || l.status === "variant" || l.status === "different"
      ? "Model number"
      : l.confidence !== null
        ? `LLM ${Math.round(l.confidence * 100)}%`
        : "Unchecked";
  return (
    <li className={`tag ${l.comparable ? "" : "tag-muted"}`}>
      <div className="tag-price">
        {l.currency === "SGD" || l.currency === null ? (
          <span className="amount">{formatSgd(l.price)}</span>
        ) : (
          <span className="amount">{l.priceText}</span>
        )}
        {l.originalPrice && <s>{formatSgd(l.originalPrice)}</s>}
      </div>
      <div className="tag-body">
        <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="shop">
          {l.source}
        </a>
        <p className="title">{l.title}</p>
        <ul className="facts">
          <li title={l.reason}>{how}</li>
          <li>{WARRANTY[l.warranty]}</li>
          {l.condition !== "new" && <li className="flag">{l.condition}</li>}
          {l.isBundle && <li className="flag">Bundle</li>}
          {l.currency && l.currency !== "SGD" && <li className="flag">Priced in {l.currency}</li>}
        </ul>
      </div>
    </li>
  );
}

function RunLog({ state }: { state: ItemState }) {
  const tools = state.trace.filter((e) => e.kind === "tool" && !e.detail.startsWith("refused")).length;
  return (
    <details className="runlog">
      <summary>
        Run log: {tools} tool call{tools === 1 ? "" : "s"}, {state.trace.length} steps
      </summary>
      <ol>
        {state.trace.map((e, i) => (
          <li key={i} className={e.ok ? "" : "fail"}>
            <span className="at">{(e.at / 1000).toFixed(1)}s</span>
            <span>
              {e.agent} · {e.kind} {e.name}
            </span>
            <span className="detail">{e.detail}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
