import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
});

test("dashboard counter route reads the independent total without changing it", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("dashboard-read", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const statements = [];
  const db = {
    prepare(sql) {
      statements.push(sql);
      return {
        bind() {
          return {
            async first() { return { total_tokens: 12345 }; },
            async run() { throw new Error("Read-only route attempted to write counter data"); },
          };
        },
      };
    },
    async batch() {},
  };

  const response = await worker.fetch(
    new Request("http://localhost/api/dashboard-token-usage?email=j.c.catling%40bham.ac.uk"),
    { DB: db },
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { totalTokens: 12345 });
  assert.equal(
    statements.some((sql) => /^\s*(?:insert|update|delete)\b/i.test(sql)),
    false,
  );
});

test("dashboard counter route has no write method", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("dashboard-write", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  let dbTouched = false;
  const db = {
    prepare() { dbTouched = true; throw new Error("Dashboard write touched the counter database"); },
    async batch() { dbTouched = true; throw new Error("Dashboard write touched the counter database"); },
  };

  const response = await worker.fetch(
    new Request("http://localhost/api/dashboard-token-usage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reset", email: "j.c.catling@bham.ac.uk" }),
    }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      DB: db,
    },
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.notEqual(response.status, 200);
  assert.equal(dbTouched, false);
});
