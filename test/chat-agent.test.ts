/**
 * The follow-up chat through the real bounded loop and tools, with a scripted
 * model and recorded search results and pages standing in for the network.
 */

import { describe, expect, it } from "vitest";
import { CHAT_TOOL_CALLS, type ChatContext, type ChatTurn } from "../src/core/chat";
import { groupListings, matchListing, type Target } from "../src/core/match";
import type { Tool } from "../src/core/quota";
import { runChat } from "../src/worker/chat";
import { SUBMIT_TOOL } from "../src/worker/agents/subagent";
import type { Model, ModelRequest, ToolCall } from "../src/worker/llm";
import { buildTools, type ToolIO } from "../src/worker/tools/index";

const target: Target = { modelNumber: "S2722QC", variant: {}, pinned: { storage: false, size: false } };
const SHOPEE = "https://shopee.sg/dell-s2722qc";
const context: ChatContext = {
  input: { mode: "model", query: "Dell S2722QC", description: "", priorities: "" },
  candidates: null,
  products: [
    {
      name: "Dell S2722QC",
      modelNumber: "S2722QC",
      groups: groupListings([
        matchListing(target, { source: "shopee.sg", url: SHOPEE, title: "Dell S2722QC 4K USB-C", priceText: "S$429.00", warranty: "local" }),
      ]),
    },
  ],
};

let nextId = 0;
const call = (name: string, args: unknown): ToolCall => ({
  id: `c${nextId++}`,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

/** Replays tool calls in order, then submits; a forced turn always submits. */
function scripted(plan: ToolCall[], submit: unknown) {
  const requests: ModelRequest[] = [];
  const model: Model = async (req) => {
    requests.push(req);
    const step = requests.length - 1;
    const calls = req.forceTool === SUBMIT_TOOL || step >= plan.length ? [call(SUBMIT_TOOL, submit)] : [plan[step]];
    return { message: { role: "assistant", content: null, tool_calls: calls } };
  };
  return { model, requests };
}

function fakeTools() {
  const used: Tool[] = [];
  const io: ToolIO = {
    search: async () => ({
      data: { web: [{ title: "Dell S2722QC review", url: "https://www.rtings.com/monitor/dell-s2722qc", description: "Good for office work" }] },
    }),
    readPage: async (url) => `Page ${url}: 3 years Dell Singapore warranty, 14-day returns. ${"Details. ".repeat(40)}`,
    scrapePage: null,
    browserMarkdown: null,
  };
  const tools = buildTools(io, { tryUse: (t) => (used.push(t), true) }, [SHOPEE]);
  return { tools, used };
}

describe("runChat", () => {
  it("answers from the gathered data without lookups and drops made-up links", async () => {
    const { model, requests } = scripted([], {
      answer: "Shopee has it for S$429.00 with local warranty.",
      sources: [SHOPEE, "https://made-up.example/deal"],
    });
    const { tools, used } = fakeTools();
    const out = await runChat("Where is it cheapest?", context, [], { model, tools });

    expect(out).toMatchObject({ ok: true, answer: "Shopee has it for S$429.00 with local warranty." });
    expect(out.sources).toEqual([{ url: SHOPEE, label: "shopee.sg" }]);
    expect(used).toEqual([]);
    const user = requests[0].messages.at(-1)!;
    expect(user.content).toContain("<gathered_data>");
    expect(user.content).toContain("S$429.00");
    expect(user.content).toContain("Question: Where is it cheapest?");
  });

  it("can search, read a listing it already knows, and cite what the lookups returned", async () => {
    const review = "https://www.rtings.com/monitor/dell-s2722qc";
    const { model } = scripted(
      [call("web_search", { query: "Dell S2722QC review" }), call("read_page", { url: SHOPEE })],
      { answer: "Reviewers like it for office work; Shopee lists 14-day returns.", sources: [review, SHOPEE] },
    );
    const { tools, used } = fakeTools();
    const events: string[] = [];
    const out = await runChat("Is it any good, and can I return it?", context, [], {
      model,
      tools,
      onEvent: (e) => events.push(`${e.agent}:${e.name}`),
    });

    expect(out.ok).toBe(true);
    expect(out.sources.map((s) => s.label)).toEqual(["rtings.com", "shopee.sg"]);
    expect(used).toEqual(["firecrawl", "jina"]);
    expect(events).toContain("chat:web_search");
    expect(events).toContain("chat:read_page");
    expect(out.trace.every((e) => e.agent === "chat")).toBe(true);
  });

  it(`never makes more than ${CHAT_TOOL_CALLS} lookups`, async () => {
    const searches = Array.from({ length: 6 }, (_, i) => call("web_search", { query: `q${i}` }));
    const { model, requests } = scripted(searches, { answer: "Here is what I found.", sources: [] });
    const { tools, used } = fakeTools();
    const out = await runChat("Tell me everything", context, [], { model, tools });

    expect(out.ok).toBe(true);
    expect(used).toHaveLength(CHAT_TOOL_CALLS);
    expect(requests.at(-1)!.forceTool).toBe(SUBMIT_TOOL);
  });

  it("sends earlier answered turns as conversation, without failed ones", async () => {
    const turns: ChatTurn[] = [
      { role: "user", text: "Which has local warranty?", at: 1 },
      { role: "assistant", text: "Shopee.", at: 2 },
      { role: "user", text: "And the price?", at: 3 },
      { role: "assistant", text: "Couldn't answer: timeout", at: 4, failed: true },
      { role: "user", text: "Is it new?", at: 5 },
    ];
    const { model, requests } = scripted([], { answer: "Yes, it's new.", sources: [] });
    const { tools } = fakeTools();
    await runChat("Is it new?", context, turns, { model, tools });

    expect(requests[0].messages.map((m) => [m.role, m.role === "system" ? "" : m.content?.slice(0, 25)])).toEqual([
      ["system", ""],
      ["user", "Which has local warranty?"],
      ["assistant", "Shopee."],
      ["user", "<gathered_data>\nShopper s"],
    ]);
  });

  it("fails soft when the model never gives a valid answer", async () => {
    const { model } = scripted([], { answer: "" });
    const { tools } = fakeTools();
    const out = await runChat("Hello?", context, [], { model, tools });
    expect(out).toMatchObject({ ok: false, answer: "", sources: [] });
    expect(out.error).toContain("invalid result");
  });
});
