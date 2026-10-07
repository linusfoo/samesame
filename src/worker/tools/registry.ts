/**
 * The tool interface every data source sits behind, whether it is a REST call
 * (Brave, Browser Rendering) or an MCP server (Tavily). Agents only see this.
 */

import type { ToolDefinition } from "../llm";

export type AgentTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Returns text for the model. Throwing is fine; the loop reports it. */
  run(args: Record<string, unknown>): Promise<string>;
};

export function toDefinition(tool: AgentTool): ToolDefinition {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}

/** Cap tool output so one page cannot flood the context window. */
export const MAX_TOOL_OUTPUT_CHARS = 6_000;

export function truncate(text: string, max = MAX_TOOL_OUTPUT_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

/** Wrap fetched web text so the model treats it as data, not instructions. */
export function asUntrusted(source: string, text: string): string {
  return `<untrusted_web_content source="${source}">\n${text}\n</untrusted_web_content>`;
}
