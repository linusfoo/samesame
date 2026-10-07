/**
 * One Durable Object per researched item. Holds the latest result in agent
 * state (synced live to the browser) and every run in SQLite.
 */

import { Agent, callable } from "agents";
import type { MatchGroups, MatchedListing } from "../../core/match";
import { canUse, consume, currentQuota, remaining, type QuotaState, type Tool, type Usage } from "../../core/quota";
import type { DiscoveryResult } from "../../core/schemas";
import { openCodeModel } from "../llm";
import { runResearch, type AgentTraceEvent, type ResearchInput } from "../research";
import { fetchMarkdown } from "../tools/browser";
import { fetchBrave } from "../tools/brave";
import { buildTools, type ToolIO } from "../tools/index";
import { tavilyExtract, tavilyMcpUrl, tavilySearch, type McpCaller } from "../tools/tavily-mcp";

export type ItemStatus = "idle" | "running" | "done" | "error";

export type ItemState = {
  input: ResearchInput | null;
  status: ItemStatus;
  phase: string;
  error: string | null;
  product: DiscoveryResult["product"] | null;
  groups: MatchGroups | null;
  matchedSources: number;
  trace: AgentTraceEvent[];
  startedAt: number | null;
  finishedAt: number | null;
  quota: QuotaState | null;
  quotaLeft: Usage | null;
  sourcesConfigured: { brave: boolean; tavily: boolean; browser: boolean; llm: boolean };
};

const TAVILY_SERVER_ID = "tavily";
const MAX_INPUT_CHARS = 500;

export class ItemAgent extends Agent<Env, ItemState> {
  initialState: ItemState = {
    input: null,
    status: "idle",
    phase: "",
    error: null,
    product: null,
    groups: null,
    matchedSources: 0,
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
    this.setState({
      ...this.state,
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
  async startResearch(raw: ResearchInput): Promise<{ started: boolean; reason?: string }> {
    if (this.state.status === "running") return { started: false, reason: "already running" };
    const input: ResearchInput = {
      query: String(raw?.query ?? "").trim().slice(0, MAX_INPUT_CHARS),
      description: String(raw?.description ?? "").trim().slice(0, MAX_INPUT_CHARS),
      priorities: String(raw?.priorities ?? "").trim().slice(0, MAX_INPUT_CHARS),
    };
    if (!input.query) return { started: false, reason: "enter a product" };
    if (!this.env.OPENCODE_API_KEY) return { started: false, reason: "OPENCODE_API_KEY is not set" };

    const quota = currentQuota(this.state.quota, new Date());
    if (!canUse(quota, "brave") && !canUse(quota, "tavily")) {
      return { started: false, reason: "today's search budget is used up; try again tomorrow" };
    }

    this.setState({
      ...this.initialState,
      input,
      status: "running",
      phase: "Starting",
      startedAt: Date.now(),
      quota,
      quotaLeft: remaining(quota),
      sourcesConfigured: this.sourcesConfigured(),
    });
    await this.queue("runResearchTask", input);
    return { started: true };
  }

  async runResearchTask(input: ResearchInput) {
    const startedAt = this.state.startedAt ?? Date.now();
    try {
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
      const tools = buildTools(io, { tryUse: (tool) => this.tryUseQuota(tool) });

      const outcome = await runResearch(input, {
        model: openCodeModel(this.env.OPENCODE_API_KEY!),
        tools,
        onPhase: (phase) => this.setState({ ...this.state, phase }),
        onEvent: (event) => this.setState({ ...this.state, trace: [...this.state.trace, event] }),
      });

      this.setState({
        ...this.state,
        status: outcome.ok ? "done" : "error",
        phase: outcome.ok ? "Done" : "Failed",
        error: outcome.error,
        product: outcome.product,
        groups: outcome.ok ? outcome.groups : null,
        matchedSources: outcome.matchedSources,
        finishedAt: Date.now(),
      });
      this.saveRun(startedAt, input, outcome.ok ? "done" : "error", outcome.error, outcome.product, outcome.listings);
    } catch (err) {
      const error = `Unexpected error: ${String(err)}`;
      this.setState({ ...this.state, status: "error", phase: "Failed", error, finishedAt: Date.now() });
      this.saveRun(startedAt, input, "error", error, null, []);
    }
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
  ) {
    this.sql`INSERT INTO runs (started_at, finished_at, input, status, error, product, listings, trace)
      VALUES (${startedAt}, ${Date.now()}, ${JSON.stringify(input)}, ${status}, ${error},
              ${JSON.stringify(product)}, ${JSON.stringify(listings)}, ${JSON.stringify(this.state.trace)})`;
  }
}
