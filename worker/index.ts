/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  COST_REPORTER_SECRET?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
const allowedEmails = new Set(["j.c.catling@bham.ac.uk", "a.z.brzozowski@bham.ac.uk"]);
const dashboardUsageUrl = "https://ai-teaching-dashboard.utah1974.chatgpt.site/api/cost-usage";
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }
function requestedEmail(request: Request) { const email = request.headers.get("x-user-email")?.trim().toLowerCase() ?? ""; return allowedEmails.has(email) ? email : null; }
async function tables(env: Env) { await env.DB.batch([env.DB.prepare("CREATE TABLE IF NOT EXISTS token_counters (user_email TEXT PRIMARY KEY, total_tokens INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)"), env.DB.prepare("CREATE TABLE IF NOT EXISTS token_usage_events (response_id TEXT PRIMARY KEY, user_email TEXT NOT NULL, tokens INTEGER NOT NULL, created_at TEXT NOT NULL)")]); }
async function record(env: Env, email: string, id: string, tokens: number) { if (!id || tokens <= 0) return; await tables(env); const now = new Date().toISOString(); const saved = await env.DB.prepare("INSERT OR IGNORE INTO token_usage_events (response_id, user_email, tokens, created_at) VALUES (?, ?, ?, ?)").bind(id, email, tokens, now).run(); if ((saved.meta.changes ?? 0) > 0) { await env.DB.prepare("INSERT INTO token_counters (user_email, total_tokens, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_email) DO UPDATE SET total_tokens = total_tokens + excluded.total_tokens, updated_at = excluded.updated_at").bind(email, tokens, now).run(); const response = await fetch(dashboardUsageUrl, { method: "POST", headers: { "content-type": "application/json", "x-cost-reporter-secret": env.COST_REPORTER_SECRET || "" }, body: JSON.stringify({ action: "add", email, tokens, eventId: `report-feedback-ai:${id}` }) }); if (!response.ok) throw new Error("Unable to update shared usage total."); } }
async function addUsage(request: Request, env: Env) { const body = await request.json() as { email?: string; tokens?: number; eventId?: string }; const user = body.email?.trim().toLowerCase() ?? ""; const tokens = Number(body.tokens); const id = body.eventId?.trim() ?? ""; if (!allowedEmails.has(user)) return json({ error: "Please sign in with an approved email address." }, 401); if (!id || !Number.isFinite(tokens) || tokens <= 0 || tokens > 100_000_000) return json({ error: "Invalid token usage." }, 400); await recordLocal(env, user, id, Math.round(tokens)); const row = await env.DB.prepare("SELECT total_tokens FROM token_counters WHERE user_email = ?").bind(user).first<{total_tokens:number}>(); return json({ totalTokens: row?.total_tokens ?? 0 }); }
async function recordLocal(env: Env, email: string, id: string, tokens: number) { if (!id || tokens <= 0) return; await tables(env); const now = new Date().toISOString(); const saved = await env.DB.prepare("INSERT OR IGNORE INTO token_usage_events (response_id, user_email, tokens, created_at) VALUES (?, ?, ?, ?)").bind(id, email, tokens, now).run(); if ((saved.meta.changes ?? 0) > 0) await env.DB.prepare("INSERT INTO token_counters (user_email, total_tokens, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_email) DO UPDATE SET total_tokens = total_tokens + excluded.total_tokens, updated_at = excluded.updated_at").bind(email, tokens, now).run(); }
async function usage(request: Request, env: Env) { const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase() ?? ""; if (!allowedEmails.has(email)) return json({ error:"Please sign in with an approved email address." }, 401); await tables(env); const row = await env.DB.prepare("SELECT total_tokens FROM token_counters WHERE user_email = ?").bind(email).first<{total_tokens:number}>(); return json({ totalTokens: row?.total_tokens ?? 0 }); }
async function dashboardUsage(request: Request, env: Env) { const response = await usage(request, env); const headers = new Headers(response.headers); headers.set("access-control-allow-origin", "https://ai-teaching-dashboard.utah1974.chatgpt.site"); headers.set("vary", "Origin"); return new Response(response.body, { status: response.status, headers }); }
async function resetUsage(request: Request, env: Env) { const { email = "" } = await request.json() as {email?:string}; const user = email.trim().toLowerCase(); if (!allowedEmails.has(user)) return json({ error:"Please sign in with an approved email address." }, 401); await tables(env); await env.DB.prepare("INSERT INTO token_counters (user_email, total_tokens, updated_at) VALUES (?, 0, ?) ON CONFLICT(user_email) DO UPDATE SET total_tokens = 0, updated_at = excluded.updated_at").bind(user, new Date().toISOString()).run(); return json({ totalTokens:0 }); }

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    if (url.pathname === "/api/token-usage" && request.method === "GET") return usage(request, env);
    if (url.pathname === "/api/dashboard-token-usage" && request.method === "GET") return dashboardUsage(request, env);
    if (url.pathname === "/api/token-usage" && request.method === "POST") {
      const body = await request.clone().json() as { action?: string };
      if (body.action === "add") return addUsage(request, env);
      if (body.action === "reset") return resetUsage(request, env);
    }

    const response = await handler.fetch(request, env, ctx);
    if (url.pathname === "/api/feedback" && request.method === "POST" && response.ok) { const email = requestedEmail(request); const id = response.headers.get("x-openai-response-id") ?? ""; const tokens = Number(response.headers.get("x-openai-total-tokens") ?? 0); if (email) try { await record(env, email, id, tokens); } catch {} }
    return response;
  },
};

export default worker;
