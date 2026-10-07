/**
 * Bounded tool loop shared by every sub-agent.
 *
 * The agent may call its tools up to maxToolCalls times, then must finish by
 * calling submit_result with JSON that passes the zod schema. One invalid
 * submission gets the validation error back; a second fails the run. Once the
 * budget or time is spent the model is forced to submit.
 */

import { z } from "zod";
import { DEFAULT_CALLS_PER_RUN } from "../../core/quota";
import { describeIssues } from "../../core/schemas";
import type { ChatMessage, Model, ToolCall, ToolDefinition } from "../llm";
import { toDefinition, truncate, type AgentTool } from "../tools/registry";

export const SUBMIT_TOOL = "submit_result";

export type TraceEvent = {
  at: number; // ms since run start
  kind: "model" | "tool" | "submit" | "note";
  name: string;
  detail: string;
  ms: number;
  ok: boolean;
};

export type AgentRunOptions<T> = {
  model: Model;
  system: string;
  /** Earlier turns of a conversation, sent between the system prompt and `user`. */
  history?: ChatMessage[];
  user: string;
  tools: AgentTool[];
  schema: z.ZodType<T>;
  submitDescription: string;
  maxToolCalls?: number;
  timeoutMs?: number;
  onEvent?: (event: TraceEvent) => void;
  now?: () => number;
};

export type AgentRunResult<T> =
  | { ok: true; result: T; trace: TraceEvent[]; toolCalls: number }
  | { ok: false; error: string; trace: TraceEvent[]; toolCalls: number };

export const DEFAULT_MAX_TOOL_CALLS = DEFAULT_CALLS_PER_RUN;
export const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_INVALID_SUBMITS = 2;
const MAX_NUDGES = 2;

export async function runBoundedAgent<T>(opts: AgentRunOptions<T>): Promise<AgentRunResult<T>> {
  const maxToolCalls = opts.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = opts.now ?? Date.now;
  const started = now();
  const trace: TraceEvent[] = [];
  const record = (e: Omit<TraceEvent, "at">) => {
    const event = { ...e, at: now() - started };
    trace.push(event);
    opts.onEvent?.(event);
  };

  const toolsByName = new Map(opts.tools.map((t) => [t.name, t]));
  const submitTool: ToolDefinition = {
    type: "function",
    function: {
      name: SUBMIT_TOOL,
      description: opts.submitDescription,
      parameters: z.toJSONSchema(opts.schema, { target: "draft-7" }) as Record<string, unknown>,
    },
  };
  const definitions = [...opts.tools.map(toDefinition), submitTool];

  const messages: ChatMessage[] = [
    { role: "system", content: opts.system },
    ...(opts.history ?? []),
    { role: "user", content: opts.user },
  ];

  let toolCalls = 0;
  let invalidSubmits = 0;
  let nudges = 0;
  // Hard stop on model rounds whatever the model does.
  const maxRounds = maxToolCalls + MAX_INVALID_SUBMITS + MAX_NUDGES + 2;

  for (let round = 0; round < maxRounds; round++) {
    const outOfTime = now() - started > timeoutMs;
    const outOfCalls = toolCalls >= maxToolCalls;
    const mustSubmit = outOfTime || outOfCalls;

    const t0 = now();
    let message;
    try {
      const response = await opts.model({
        messages: [...messages],
        // When forced, only offer submit_result so the model cannot wander.
        tools: mustSubmit ? [submitTool] : definitions,
        forceTool: mustSubmit ? SUBMIT_TOOL : undefined,
      });
      message = response.message;
      const tokens = response.usage
        ? ` ${response.usage.prompt_tokens ?? "?"}→${response.usage.completion_tokens ?? "?"} tok`
        : "";
      record({ kind: "model", name: `round ${round + 1}`, detail: `${mustSubmit ? "forced submit" : "free"}${tokens}`, ms: now() - t0, ok: true });
    } catch (err) {
      record({ kind: "model", name: `round ${round + 1}`, detail: String(err), ms: now() - t0, ok: false });
      return { ok: false, error: `model call failed: ${String(err)}`, trace, toolCalls };
    }

    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls });
    const calls = message.tool_calls ?? [];

    if (calls.length === 0) {
      if (nudges >= MAX_NUDGES) break;
      nudges++;
      record({ kind: "note", name: "nudge", detail: "no tool call; asked to submit", ms: 0, ok: false });
      messages.push({ role: "user", content: `Call ${SUBMIT_TOOL} with your answer now.` });
      continue;
    }

    for (const call of calls) {
      if (call.function.name === SUBMIT_TOOL) {
        const outcome = checkSubmission(call, opts.schema);
        if (outcome.ok) {
          record({ kind: "submit", name: SUBMIT_TOOL, detail: "valid", ms: 0, ok: true });
          return { ok: true, result: outcome.value, trace, toolCalls };
        }
        invalidSubmits++;
        record({ kind: "submit", name: SUBMIT_TOOL, detail: outcome.error, ms: 0, ok: false });
        if (invalidSubmits >= MAX_INVALID_SUBMITS) {
          return { ok: false, error: `invalid result: ${outcome.error}`, trace, toolCalls };
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: `Invalid result: ${outcome.error}. Fix these fields and call ${SUBMIT_TOOL} again.`,
        });
        continue;
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: await runTool(call) });
    }
  }

  return { ok: false, error: "agent stopped without a valid result", trace, toolCalls };

  async function runTool(call: ToolCall): Promise<string> {
    const tool = toolsByName.get(call.function.name);
    if (!tool) {
      record({ kind: "tool", name: call.function.name, detail: "unknown tool", ms: 0, ok: false });
      return `Unknown tool ${call.function.name}.`;
    }
    if (toolCalls >= maxToolCalls || now() - started > timeoutMs) {
      record({ kind: "tool", name: tool.name, detail: "refused: budget spent", ms: 0, ok: false });
      return `Tool budget used up. Call ${SUBMIT_TOOL} with what you have.`;
    }
    toolCalls++;
    const args = parseArgs(call.function.arguments);
    const t0 = now();
    try {
      const output = truncate(await tool.run(args));
      record({ kind: "tool", name: tool.name, detail: summariseArgs(args), ms: now() - t0, ok: true });
      return output;
    } catch (err) {
      record({ kind: "tool", name: tool.name, detail: `${summariseArgs(args)} → ${String(err)}`, ms: now() - t0, ok: false });
      return `Tool error: ${String(err)}`;
    }
  }
}

function checkSubmission<T>(
  call: ToolCall,
  schema: z.ZodType<T>,
): { ok: true; value: T } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(call.function.arguments || "{}");
  } catch {
    return { ok: false, error: "arguments are not valid JSON" };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: describeIssues(parsed.error) };
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function summariseArgs(args: Record<string, unknown>): string {
  return truncate(JSON.stringify(args), 160);
}
