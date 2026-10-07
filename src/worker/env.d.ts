// Secrets from .dev.vars locally or `wrangler secret put` when deployed.
interface Env {
  OPENCODE_API_KEY?: string;
  /** Firecrawl (search, and a second page reader): free account, no card. */
  FIRECRAWL_API_KEY?: string;
  /** Optional: Jina Reader works without a key; a free key raises its rate limit. */
  JINA_API_KEY?: string;
  /** Optional fallback page reader: free Cloudflare account, no card. */
  CF_ACCOUNT_ID?: string;
  CF_BROWSER_TOKEN?: string;
}
