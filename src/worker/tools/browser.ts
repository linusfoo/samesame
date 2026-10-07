/**
 * Cloudflare Browser Rendering REST /markdown: the fallback when Jina Reader
 * cannot extract a page. Free plan minutes are scarce, so callers gate it
 * behind the quota.
 */

const BROWSER_TIMEOUT_MS = 30_000;

export async function fetchMarkdown(accountId: string, token: string, url: string): Promise<string> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/markdown`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ url, rejectResourceTypes: ["image", "media", "font", "stylesheet"] }),
      signal: AbortSignal.timeout(BROWSER_TIMEOUT_MS),
    },
  );
  if (!res.ok) throw new Error(`Browser Rendering returned ${res.status}`);
  const data = (await res.json()) as { success: boolean; result?: string; errors?: unknown[] };
  if (!data.success || !data.result) throw new Error("Browser Rendering returned no content");
  return data.result;
}
