/**
 * One Durable Object per researched item. Holds what the page shows in agent
 * state (synced live to the browser) and every run, in full, in SQLite.
 *
 * Model mode researches one product. Category mode first proposes candidate
 * models, then researches the shopper's picks (up to two) in parallel.
 */

import { Agent, callable } from "agents";
import type { MatchGroups, MatchedListing } from "../../core/match";
import { canUse, consume, currentQuota, remaining, type QuotaState, type Tool, type Usage } from "../../core/quota";
import { checkPicks, parseResearchInput, type Mode, type ResearchInput } from "../../core/request";
import type { Candidate, DiscoveryResult } from "../../core/schemas";
import { openCodeModel } from "../llm";
import {
  candidateInput,
  runCandidates,
  runResearch,
  type AgentTraceEvent,
  type ResearchDeps,
} from "../research";
import { fetchMarkdown } from "../tools/browser";
import { fetchBrave } from "../tools/brave";
import { buildTools, type ToolIO } from "../tools/index";
import { tavilyExtract, tavilyMcpUrl, tavilySearch, type McpCaller } from "../tools/tavily-mcp";

export type ItemStatus = "idle" | "running" | "choosing" | "done" | "error";

/** One researched product: the single product in model mode, or one picked candidate. */
export type ProductResult = {
  key: string;
  query: string;
  status: "running" | "done" | "error";
  phase: string;
  error: string | null;
  product: DiscoveryResult["product"] | null;
  groups: MatchGroups | null;
  matchedSources: number;
  startedAt: number;
  finishedAt: number | null;
};

export type ItemState = {
  input: ResearchInput | null;
  mode: Mode;
  status: ItemStatus;
  phase: string;
  error: string | null;
  candidates: Candidate[] | null;
  /** Candidate indexes being or already compared. */
  picked: number[];
  products: ProductResult[];
  /** The most recent run-log events; the full log is in the runs table. */
  trace: AgentTraceEvent[];
  startedAt: number | null;
  finishedAt: number | null;
  quota: QuotaState | null;
  quotaLeft: Usage | null;
  sourcesConfigured: { brave: boolean; tavily: boolean; browser: boolean; llm: boolean };
};

const TAVILY_SERVER_ID = "tavily";
const MAX_TRACE_IN_STATE = 80;

export class ItemAgent extends Agent<Env, ItemState> {
  initialState: ItemState = {
    input: null,
    mode: "model",
    status: "idle",
    phase: "",
    error: null,
    candidates: null,
    picked: [],
    products: [],
    trace: [],
    startedAt: null,
    finishedAt: null,
    quota: null,
    quotaLeft: null,
    sourcesConfigured: { brave: false, tavily: false, browser: false, llm: false },
  };

  async onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      input TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      product TEXT,
      listings TEXT,
      trace TEXT
    )`;
    const quota = currentQuota(this.state.quota, new Date());
    // State saved before category mode had product/groups at the top level; start those fresh.
    const old = this.state as Partial<ItemState>;
    const fresh = !Array.isArray(old.products);
    this.setState({
      ...(fresh ? this.initialState : this.state),
      quota,
      quotaLeft: remaining(quota),
      sourcesConfigured: this.sourcesConfigured(),
      // A run cannot survive an eviction; do not leave the UI spinning.
      ...(this.state.status === "running"
        ? { status: "error" as const, error: "The previous run was interrupted. Try again." }
        : {}),
    });
  }

  @callable()
  async startResearch(raw: unknown): Promise<{ started: boolean; reason?: string }> {
    if (this.state.status === "running") return { started: false, reason: "a search is already running" };
    const parsed = parseResearchInput(raw);
    if (!parsed.ok) return { started: false, reason: parsed.reason };
    if (!this.env.OPENCODE_API_KEY) return { started: false, reason: "OPENCODE_API_KEY is not set" };

    const quota = currentQuota(this.state.quota, new Date());
    if (!canUse(quota, "brave") && !canUse(quota, "tavily")) {
      return { started: false, reason: "today's search budget is used up; try again tomorrow" };
    }

    const input = parsed.value;
    this.setState({
      ...this.initialState,
      input,
      mode: input.mode,
      status: "running",
      phase: "Starting",
      startedAt: Date.now(),
      quota,
      quotaLeft: remaining(quota),
      sourcesConfigured: this.sourcesConfigured(),
    });
    await this.queue("runStartTask", input);
    return { started: true };
  }

  @callable()
  async compareCandidates(raw: unknown): Promise<{ started: boolean; reason?: string }> {
    const { input, candidates, status } = this.state;
    if (status === "running") return { started: false, reason: "a search is already running" };
    if (!input || input.mode !== "category" || !candidates) {
      return { started: false, reason: "search a category first" };
    }
    const quota = currentQuota(this.state.quota, new Date());
    const picks = checkPicks(raw, candidates.length, remaining(quota));
    if (!picks.ok) return { started: false, reason: picks.reason };

    this.setState({
      ...this.state,
      status: "running",
      phase: `Comparing ${picks.value.length} model${picks.value.length === 1 ? "" : "s"}`,
      error: null,
      picked: picks.value,
      products: [],
      startedAt: Date.now(),
      finishedAt: null,
      quota,
      quotaLeft: remaining(quota),
    });
    await this.queue("runCompareTask", { indexes: picks.value });
    return { started: true };
  }

  async runStartTask(input: ResearchInput) {
    const startedAt = this.state.startedAt ?? Date.now();
    try {
      if (input.mode === "model") {
        await this.researchOne("model", input);
        this.finishRun();
        return;
      }
      const outcome = await runCandidates(input, await this.deps());
      this.setState({
        ...this.state,
        status: outcome.ok ? "choosing" : "error",
        phase: outcome.ok ? "Pick up to two to compare" : "Failed",
        error: outcome.error,
        candidates: outcome.ok ? outcome.candidates : null,
        finishedAt: Date.now(),
      });
      this.saveRun(startedAt, input, outcome.ok ? "done" : "error", outcome.error, outcome.candidates, [], outcome.trace);
    } catch (err) {
      this.failRun(startedAt, input, err);
    }
  }

  async runCompareTask({ indexes }: { indexes: number[] }) {
    const input = this.state.input!;
    const candidates = this.state.candidates ?? [];
    try {
      await Promise.all(indexes.map((i) => this.researchOne(`c${i}`, candidateInput(input, candidates[i]))));
      this.finishRun();
    } catch (err) {
      this.failRun(this.state.startedAt ?? Date.now(), input, err);
    }
  }

  /** Research one product and keep its result under `key`. Safe to run in parallel. */
  private async researchOne(key: string, input: ResearchInput) {
    const startedAt = Date.now();
    this.updateProduct(key, {
      key,
      query: input.query,
      status: "running",
      phase: "Starting",
      error: null,
      product: null,
      groups: null,
      matchedSources: 0,
      startedAt,
      finishedAt: null,
    });
    const deps = await this.deps();
    const outcome = await runResearch(input, {
      ...deps,
      item: key,
      onPhase: (phase) => {
        this.updateProduct(key, { phase });
        if (this.state.mode === "model") this.setState({ ...this.state, phase });
      },
    });
    this.updateProduct(key, {
      status: outcome.ok ? "done" : "error",
      phase: outcome.ok ? "Done" : "Failed",
      error: outcome.error,
      product: outcome.product,
      groups: outcome.ok ? outcome.groups : null,
      matchedSources: outcome.matchedSources,
      finishedAt: Date.now(),
    });
    this.saveRun(startedAt, input, outcome.ok ? "done" : "error", outcome.error, outcome.product, outcome.listings, outcome.trace);
  }

  private finishRun() {
    const failed = this.state.products.filter((p) => p.status === "error");
    const allFailed = failed.length > 0 && failed.length === this.state.products.length;
    this.setState({
      ...this.state,
      status: allFailed ? "error" : "done",
      phase: allFailed ? "Failed" : "Done",
      error: allFailed ? failed[0].error : null,
      finishedAt: Date.now(),
    });
  }

  private failRun(startedAt: number, input: ResearchInput, err: unknown) {
    const error = `Unexpected error: ${String(err)}`;
    this.setState({ ...this.state, status: "error", phase: "Failed", error, finishedAt: Date.now() });
    this.saveRun(startedAt, input, "error", error, null, [], this.state.trace);
  }

  /** Merge into one product's entry, reading the latest state so parallel runs don't clobber each other. */
  private updateProduct(key: string, patch: Partial<ProductResult>) {
    const products = [...this.state.products];
    const i = products.findIndex((p) => p.key === key);
    if (i === -1) products.push(patch as ProductResult);
    else products[i] = { ...products[i], ...patch };
    this.setState({ ...this.state, products });
  }

  private async deps(): Promise<ResearchDeps> {
    const mcp = await this.tavilyCaller();
    const io: ToolIO = {
      brave: this.env.BRAVE_API_KEY ? (q) => fetchBrave(this.env.BRAVE_API_KEY!, q) : null,
      tavilySearch: mcp ? (q) => tavilySearch(mcp, q) : null,
      tavilyExtract: mcp ? (u) => tavilyExtract(mcp, u) : null,
      browserMarkdown:
        this.env.CF_ACCOUNT_ID && this.env.CF_BROWSER_TOKEN
          ? (u) => fetchMarkdown(this.env.CF_ACCOUNT_ID!, this.env.CF_BROWSER_TOKEN!, u)
          : null,
    };
    return {
      model: openCodeModel(this.env.OPENCODE_API_KEY!),
      tools: buildTools(io, { tryUse: (tool) => this.tryUseQuota(tool) }),
      onPhase: (phase) => this.setState({ ...this.state, phase }),
      onEvent: (event) =>
        this.setState({ ...this.state, trace: [...this.state.trace, event].slice(-MAX_TRACE_IN_STATE) }),
    };
  }

  @callable()
  listRuns(): { id: number; started_at: number; status: string; query: string }[] {
    return this.sql<{ id: number; started_at: number; status: string; input: string }>`
      SELECT id, started_at, status, input FROM runs ORDER BY id DESC LIMIT 20`.map((r) => ({
      id: r.id,
      started_at: r.started_at,
      status: r.status,
      query: (JSON.parse(r.input) as ResearchInput).query,
    }));
  }

  private tryUseQuota(tool: Tool): boolean {
    const quota = currentQuota(this.state.quota, new Date());
    if (!canUse(quota, tool)) return false;
    const next = consume(quota, tool);
    this.setState({ ...this.state, quota: next, quotaLeft: remaining(next) });
    return true;
  }

  private async tavilyCaller(): Promise<McpCaller | null> {
    const key = this.env.TAVILY_API_KEY;
    if (!key) return null;
    try {
      const existing = this.getMcpServers().servers[TAVILY_SERVER_ID];
      if (!existing) {
        const result = await this.addMcpServer("tavily", tavilyMcpUrl(key), { id: TAVILY_SERVER_ID });
        if (result.state !== "ready") return null;
      }
      await this.mcp.waitForConnections({ timeout: 10_000 });
      const names = this.mcp
        .listTools()
        .filter((t) => t.serverId === TAVILY_SERVER_ID)
        .map((t) => t.name);
      if (names.length === 0) return null;
      return {
        toolNames: () => names,
        call: async (name, args) =>
          (await this.mcp.callTool({ serverId: TAVILY_SERVER_ID, name, arguments: args })) as Awaited<
            ReturnType<McpCaller["call"]>
          >,
      };
    } catch (err) {
      console.warn("Tavily MCP unavailable:", err);
      return null;
    }
  }

  private sourcesConfigured(): ItemState["sourcesConfigured"] {
    return {
      brave: Boolean(this.env.BRAVE_API_KEY),
      tavily: Boolean(this.env.TAVILY_API_KEY),
      browser: Boolean(this.env.CF_ACCOUNT_ID && this.env.CF_BROWSER_TOKEN),
      llm: Boolean(this.env.OPENCODE_API_KEY),
    };
  }

  private saveRun(
    startedAt: number,
    input: ResearchInput,
    status: string,
    error: string | null,
    product: unknown,
    listings: MatchedListing[],
    trace: AgentTraceEvent[],
  ) {
    this.sql`INSERT INTO runs (started_at, finished_at, input, status, error, product, listings, trace)
      VALUES (${startedAt}, ${Date.now()}, ${JSON.stringify(input)}, ${status}, ${error},
              ${JSON.stringify(product)}, ${JSON.stringify(listings)}, ${JSON.stringify(trace)})`;
  }
}
