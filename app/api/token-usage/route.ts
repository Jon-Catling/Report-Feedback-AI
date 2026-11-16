const DASHBOARD_URL = "https://ai-teaching-dashboard.utah1974.chatgpt.site/api/cost-usage";
const ALLOWED = new Set(["j.c.catling@bham.ac.uk", "a.z.brzozowski@bham.ac.uk"]);
const email = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
export async function GET(request: Request) {
  const user = email(new URL(request.url).searchParams.get("email"));
  if (!ALLOWED.has(user)) return Response.json({ error: "Unauthorised email address." }, { status: 403 });
  const response = await fetch(`${DASHBOARD_URL}?email=${encodeURIComponent(user)}`, { cache: "no-store" });
  return new Response(response.body, { status: response.status, headers: { "content-type": "application/json" } });
}
export async function POST(request: Request) {
  const body = await request.json() as { action?: string; email?: string; tokens?: number; eventId?: string };
  const user = email(body.email);
  if (!ALLOWED.has(user)) return Response.json({ error: "Unauthorised request." }, { status: 403 });
  if (body.action === "add") {
    const tokens = Number(body.tokens);
    if (!Number.isFinite(tokens) || tokens <= 0 || tokens > 100_000_000) return Response.json({ error: "Invalid token usage." }, { status: 400 });
    const response = await fetch(DASHBOARD_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cost-reporter-secret": process.env.COST_REPORTER_SECRET || "" },
      body: JSON.stringify({ action: "add", email: user, tokens: Math.round(tokens), eventId: body.eventId || undefined }),
    });
    return new Response(response.body, { status: response.status, headers: { "content-type": "application/json" } });
  }
  if (body.action !== "reset") return Response.json({ error: "Unauthorised request." }, { status: 403 });
  const response = await fetch(DASHBOARD_URL, { method: "POST", headers: { "content-type": "application/json", "x-cost-reporter-secret": process.env.COST_REPORTER_SECRET || "" }, body: JSON.stringify({ action: "reset", email: user }) });
  return new Response(response.body, { status: response.status, headers: { "content-type": "application/json" } });
}
