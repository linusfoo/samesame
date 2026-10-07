import { useEffect, useState } from "react";
import { useAgent } from "agents/react";
import type { ItemAgent, ItemState } from "../worker/agents/item";
import type { ResearchInput } from "../core/request";
import { Ask } from "./Ask";
import { Results } from "./Results";
import { Logo } from "./Logo";
import { Hero3D } from "./Hero3D";
import { Landing } from "./Landing";

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

/** ?demo=model|category|compared|chat|running|error in dev shows a sample state. */
const demoName = import.meta.env.DEV ? new URLSearchParams(location.search).get("demo") : null;

export type Actions = {
  start(input: ResearchInput): Promise<string | null>;
  compare(indexes: number[]): Promise<string | null>;
  ask(question: string): Promise<string | null>;
};

export function App() {
  const [id] = useState(itemId);
  const [live, setLive] = useState<ItemState | null>(null);
  const [demo, setDemo] = useState<ItemState | null>(null);
  const agent = useAgent<ItemAgent, ItemState>({
    agent: "item-agent",
    name: id,
    onStateUpdate: (s) => setLive(s),
  });

  useEffect(() => {
    if (!demoName) return;
    import("./demo").then(({ DEMOS }) => setDemo(DEMOS[demoName] ?? null));
  }, []);

  const state = demo ?? live;

  // Two pages: the landing page at /, the search at /search (demo pages always open the search).
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  function go(to: string) {
    history.pushState(null, "", to + location.search);
    setPath(to);
    window.scrollTo(0, 0);
  }
  const onSearch = Boolean(demoName) || path.startsWith("/search");

  const actions: Actions = {
    async start(input) {
      if (demo) return "This is a demo page; searches are off.";
      const res = await agent.stub.startResearch(input);
      return res.started ? null : `Couldn't start: ${res.reason}.`;
    },
    async compare(indexes) {
      if (demo) return "This is a demo page; searches are off.";
      const res = await agent.stub.compareCandidates(indexes);
      return res.started ? null : `Couldn't compare: ${res.reason}.`;
    },
    async ask(question) {
      if (demo) return "This is a demo page; questions are off.";
      const res = await agent.stub.ask(question);
      return res.started ? null : `Couldn't ask: ${res.reason}.`;
    },
  };

  return (
    <div className="page">
      <header className="topbar">
        <a
          className="identity"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            go("/");
          }}
        >
          <span className="mark">
            <Logo />
          </span>
          <div>
            <strong>SameSame</strong>
            <small>Singapore, prices in SGD</small>
          </div>
        </a>
        <RunStatus state={state} />
      </header>

      {onSearch ? (
        <>
          <header className="masthead masthead-search">
            <div className="masthead-copy">
              <h1>What are you buying?</h1>
              <p>Name the model, or just the kind of product. The tags shuffle while the agents search.</p>
            </div>
            <Hero3D busy={state?.status === "running"} />
          </header>

          <Ask state={state} actions={actions} />

          <main className="results" aria-live="polite">
            {state ? <Results state={state} actions={actions} /> : <p className="quiet">Connecting…</p>}
          </main>

          {state && <Footer state={state} />}
        </>
      ) : (
        <main>
          <Landing state={state} go={go} />
        </main>
      )}
    </div>
  );
}

const STATUS_TEXT: Record<ItemState["status"], string> = {
  idle: "Agents ready",
  running: "Agents searching",
  choosing: "Waiting for your pick",
  done: "Run finished",
  error: "Run stopped",
};

function RunStatus({ state }: { state: ItemState | null }) {
  const status = state?.status ?? "idle";
  return (
    <div className={`run-status is-${state ? status : "offline"}`}>
      <i aria-hidden="true" />
      <span>{state ? STATUS_TEXT[status] : "Connecting"}</span>
    </div>
  );
}

function Footer({ state }: { state: ItemState }) {
  const c = state.sourcesConfigured;
  const missing = [!c.llm && "OPENCODE_API_KEY", !c.search && "FIRECRAWL_API_KEY"].filter(Boolean);
  const left = state.quotaLeft;
  return (
    <footer className="footer">
      {left && (
        <p>
          Left today for new searches: {left.firecrawl} web searches and {left.jina + left.browser} page reads. The rest
          is kept for watchlist checks.
        </p>
      )}
      {missing.length > 0 && (
        <p className="warn">
          Not set up: {missing.join(" and ")}. Add {missing.length === 1 ? "it" : "them"} to .dev.vars.
        </p>
      )}
      {!c.browser && (
        <p>Optional: add CF_ACCOUNT_ID and CF_BROWSER_TOKEN for one more way to read pages a shop blocks.</p>
      )}
    </footer>
  );
}
