// Secrets from .dev.vars locally or `wrangler secret put` when deployed.
interface Env {
  OPENCODE_API_KEY?: string;
  /** Serper (Google search): free plan, no card. */
  SERPER_API_KEY?: string;
  /** Optional: Jina Reader works without a key; a free key raises its rate limit. */
  JINA_API_KEY?: string;
  /** Optional fallback page reader: free Cloudflare account, no card. */
  CF_ACCOUNT_ID?: string;
  CF_BROWSER_TOKEN?: string;
}
