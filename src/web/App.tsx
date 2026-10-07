import { useEffect, useState } from "react";
import { useAgent } from "agents/react";
import type { ItemAgent, ItemState } from "../worker/agents/item";
import type { ResearchInput } from "../core/request";
import { Ask } from "./Ask";
import { Results } from "./Results";

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

/** ?demo=model|category|compared|running|error in dev shows a sample state. */
const demoName = import.meta.env.DEV ? new URLSearchParams(location.search).get("demo") : null;

export type Actions = {
  start(input: ResearchInput): Promise<string | null>;
  compare(indexes: number[]): Promise<string | null>;
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
  };

  return (
    <div className="page">
      <header className="masthead">
        <h1>Buying Helper</h1>
        <p>Finds what you want across Singapore shops and shows which listings are really the same item, and what each one costs.</p>
      </header>

      <Ask state={state} actions={actions} />

      <main className="results" aria-live="polite">
        {state ? <Results state={state} actions={actions} /> : <p className="quiet">Connecting…</p>}
      </main>

      {state && <Footer state={state} />}
    </div>
  );
}

function Footer({ state }: { state: ItemState }) {
  const c = state.sourcesConfigured;
  const missing = [!c.llm && "OPENCODE_API_KEY", !c.search && "SERPER_API_KEY"].filter(Boolean);
  const left = state.quotaLeft;
  return (
    <footer className="footer">
      {left && (
        <p>
          Left today for new searches: {left.serper} web searches and {left.jina + left.browser} page reads. The rest
          is kept for watchlist checks.
        </p>
      )}
      {missing.length > 0 && (
        <p className="warn">
          Not set up: {missing.join(" and ")}. Add {missing.length === 1 ? "it" : "them"} to .dev.vars.
        </p>
      )}
      {!c.browser && (
        <p>Optional: add CF_ACCOUNT_ID and CF_BROWSER_TOKEN for a second way to read pages a shop blocks.</p>
      )}
    </footer>
  );
}
