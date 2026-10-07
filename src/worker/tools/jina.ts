/**
 * Jina Reader: any public page as markdown. Works with no key (about 20
 * pages a minute); a free JINA_API_KEY raises the limit. Cloudflare Browser
 * Rendering is the fallback when Jina is blocked or returns too little.
 */

const JINA_URL = "https://r.jina.ai/";
const JINA_TIMEOUT_MS = 30_000;

export async function fetchJina(url: string, apiKey?: string): Promise<string> {
  const res = await fetch(`${JINA_URL}${url}`, {
    headers: {
      accept: "text/plain",
      "x-return-format": "markdown",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    signal: AbortSignal.timeout(JINA_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Jina Reader returned ${res.status}`);
  return res.text();
}
