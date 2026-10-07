import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runBoundedAgent, SUBMIT_TOOL } from "../src/worker/agents/subagent";
import type { Model, ModelRequest, ToolCall } from "../src/worker/llm";
import type { AgentTool } from "../src/worker/tools/registry";

const Schema = z.object({ answer: z.string() });

let nextId = 0;
function call(name: string, args: unknown): ToolCall {
  return { id: `c${nextId++}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

/** A model that replays scripted tool calls and records every request. */
function scripted(turns: ((req: ModelRequest) => ToolCall[] | string)[]) {
  const requests: ModelRequest[] = [];
  const model: Model = async (req) => {
    requests.push(req);
    const turn = turns[Math.min(requests.length - 1, turns.length - 1)];
    const out = turn(req);
    return typeof out === "string"
      ? { message: { role: "assistant", content: out } }
      : { message: { role: "assistant", content: null, tool_calls: out } };
  };
  return { model, requests };
}

function countingTool(): AgentTool & { calls: number } {
  const tool = {
    name: "search",
    description: "search",
    parameters: { type: "object", properties: { q: { type: "string" } } },
    calls: 0,
    async run() {
      tool.calls++;
      return "results";
    },
  };
  return tool;
}

const base = { system: "s", user: "u", schema: Schema, submitDescription: "submit" };

describe("runBoundedAgent", () => {
  it("returns a valid submission", async () => {
    const { model } = scripted([
      () => [call("search", { q: "x" })],
      () => [call(SUBMIT_TOOL, { answer: "done" })],
    ]);
    const tool = countingTool();
    const run = await runBoundedAgent({ ...base, model, tools: [tool] });
    expect(run).toMatchObject({ ok: true, result: { answer: "done" }, toolCalls: 1 });
    expect(tool.calls).toBe(1);
  });

  it("never runs more than maxToolCalls tools and then forces submit", async () => {
    const { model, requests } = scripted([
      (req) =>
        req.forceTool === SUBMIT_TOOL
          ? [call(SUBMIT_TOOL, { answer: "forced" })]
          : [call("search", { q: "a" }), call("search", { q: "b" })],
    ]);
    const tool = countingTool();
    const run = await runBoundedAgent({ ...base, model, tools: [tool], maxToolCalls: 3 });
    expect(tool.calls).toBe(3);
    expect(run).toMatchObject({ ok: true, result: { answer: "forced" } });
    const last = requests[requests.length - 1];
    expect(last.forceTool).toBe(SUBMIT_TOOL);
    expect(last.tools.map((t) => t.function.name)).toEqual([SUBMIT_TOOL]);
  });

  it("feeds a validation error back once, then accepts the fix", async () => {
    const { model, requests } = scripted([
      () => [call(SUBMIT_TOOL, { answer: 42 })],
      () => [call(SUBMIT_TOOL, { answer: "fixed" })],
    ]);
    const run = await runBoundedAgent({ ...base, model, tools: [] });
    expect(run).toMatchObject({ ok: true, result: { answer: "fixed" } });
    const feedback = requests[1].messages.at(-1);
    expect(feedback).toMatchObject({ role: "tool" });
    expect(JSON.stringify(feedback)).toContain("answer");
  });

  it("fails after two invalid submissions", async () => {
    const { model } = scripted([() => [call(SUBMIT_TOOL, { wrong: true })]]);
    const run = await runBoundedAgent({ ...base, model, tools: [] });
    expect(run.ok).toBe(false);
  });

  it("forces submit once the time budget is spent", async () => {
    let clock = 0;
    const { model, requests } = scripted([
      (req) => {
        clock += 60_000;
        return req.forceTool ? [call(SUBMIT_TOOL, { answer: "late" })] : [call("search", { q: "x" })];
      },
    ]);
    const run = await runBoundedAgent({ ...base, model, tools: [countingTool()], timeoutMs: 90_000, now: () => clock });
    expect(run).toMatchObject({ ok: true, result: { answer: "late" } });
    expect(requests.length).toBeLessThanOrEqual(3);
  });

  it("nudges a model that answers in plain text", async () => {
    const { model } = scripted([() => "here is my answer", () => [call(SUBMIT_TOOL, { answer: "ok" })]]);
    const run = await runBoundedAgent({ ...base, model, tools: [] });
    expect(run).toMatchObject({ ok: true, result: { answer: "ok" } });
    expect(run.trace.some((e) => e.name === "nudge")).toBe(true);
  });

  it("reports tool errors to the model instead of crashing", async () => {
    const failing: AgentTool = { ...countingTool(), run: async () => { throw new Error("boom"); } };
    const { model, requests } = scripted([
      () => [call("search", { q: "x" })],
      () => [call(SUBMIT_TOOL, { answer: "recovered" })],
    ]);
    const run = await runBoundedAgent({ ...base, model, tools: [failing] });
    expect(run.ok).toBe(true);
    expect(JSON.stringify(requests[1].messages.at(-1))).toContain("boom");
  });

  it("returns an error when the model call throws", async () => {
    const model: Model = async () => { throw new Error("503"); };
    const run = await runBoundedAgent({ ...base, model, tools: [] });
    expect(run).toMatchObject({ ok: false });
  });
});
