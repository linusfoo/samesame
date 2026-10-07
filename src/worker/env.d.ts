// Secrets from .dev.vars locally or `wrangler secret put` when deployed.
interface Env {
  OPENCODE_API_KEY?: string;
  BRAVE_API_KEY?: string;
  TAVILY_API_KEY?: string;
  CF_ACCOUNT_ID?: string;
  CF_BROWSER_TOKEN?: string;
}
