/**
 * OpenCode Go client (OpenAI-compatible chat completions), as used in
 * project4/lunch-uncle/src/loop.js.
 */

// callModel appends /chat/completions.
export const LLM_BASE_URL = "https://opencode.ai/zen/go/v1";
export const LLM_MODEL = "deepseek-v4.1-flash";
const LLM_TIMEOUT_MS = 45_000;

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolDefinition = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ModelRequest = {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  /** Force a specific tool, e.g. submit_result once the budget is spent. */
  forceTool?: string;
};

export type ModelResponse = {
  message: Extract<ChatMessage, { role: "assistant" }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/** Anything that answers a chat request; tests pass a scripted fake. */
export type Model = (request: ModelRequest) => Promise<ModelResponse>;

export function openCodeModel(apiKey: string, sessionId: string = crypto.randomUUID()): Model {
  return async ({ messages, tools, forceTool }) => {
    const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        // One session per agent run so the endpoint can route and cache consistently.
        "x-opencode-session": sessionId,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: forceTool ? { type: "function", function: { name: forceTool } } : undefined,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`LLM returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices: { message: ModelResponse["message"] }[];
      usage?: ModelResponse["usage"];
    };
    return { message: data.choices[0].message, usage: data.usage };
  };
}
