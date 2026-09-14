import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { afterEach, mock, test } from "node:test";
import worker from "../src/worker.js";

const SOURCE = "https://github.com/user-attachments/files/123/preview.html";
const ASSET = "https://github.com/user-attachments/assets/12345678-abcd-4321-abcd-123456789abc";
const STORAGE =
  "https://objects.githubusercontent.com/github-production-repository-file-5c1aeb/42/123?X-Amz-Signature=temporary";
const HTML =
  '<!doctype html><html><head><title>Proof</title></head><body><button>Compare</button><script>document.body.dataset.ready="yes"</script></body></html>';
const reportRequest = (source = SOURCE, options) =>
  new Request(`https://preview.example/render?${new URLSearchParams({ url: source })}`, options);

afterEach(() => mock.restoreAll());

test("a public attachment is loaded through its storage redirect without visitor credentials", async () => {
  const calls = [];
  mock.method(globalThis, "fetch", async (url, options) => {
    calls.push(url);
    const headers = new Headers(options.headers);
    assert.equal(headers.get("authorization"), null);
    assert.equal(headers.get("cookie"), null);
    assert.equal(options.redirect, "manual");
    if (url === SOURCE) return new Response(null, { status: 302, headers: { Location: STORAGE } });
    assert.equal(url, STORAGE);
    return new Response(HTML, {
      headers: {
        "Content-Type": "text/html",
        "Content-Disposition": "attachment",
        "Set-Cookie": "upstream=secret",
      },
    });
  });
  const response = await worker.fetch(
    reportRequest(SOURCE, {
      headers: { Authorization: "Bearer private", Cookie: "session=private" },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), HTML);
  assert.deepEqual(calls, [SOURCE, STORAGE]);
  assert.equal(response.headers.get("content-disposition"), "inline");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-security-policy"), /sandbox allow-scripts/);
  assert.doesNotMatch(response.headers.get("content-security-policy"), /allow-same-origin/);
  assert.match(response.headers.get("content-security-policy"), /connect-src 'none'/);
});

test("the preview entry point preserves attachment identity without fetching ahead of the frame", async () => {
  const fetch = mock.method(globalThis, "fetch", () => {
    throw new Error("Unexpected fetch");
  });
  const source = "https://github.com/user-attachments/files/123/phone%20and%20desktop.html";
  const response = await worker.fetch(
    new Request(`https://preview.example/?${new URLSearchParams({ url: source })}`),
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes(`/render?${new URLSearchParams({ url: source })}`));
  assert.match(
    html,
    /<iframe[^>]*sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"/,
  );
  assert.equal(fetch.mock.calls.length, 0);
});

test("unsupported source addresses never make an outbound request", async () => {
  const fetch = mock.method(globalThis, "fetch", () => {
    throw new Error("Unexpected fetch");
  });
  for (const source of [
    "http://127.0.0.1/private",
    "https://github.com.evil.example/user-attachments/files/123/report.html",
    "https://github.com/login",
    "https://user:secret@github.com/user-attachments/files/123/report.html",
    `${SOURCE}?token=secret`,
    `${SOURCE}#section`,
    "https://github.com/user-attachments/files/123/file.zip",
    "https://github.com/user-attachments/files/123/sub%2ffile.html",
    "https://github.com/user-attachments/files/123/%0afile.html",
    "https://github.com:444/user-attachments/files/123/report.html",
    "https://github.com/user-attachments/assets/not-a-uuid",
  ]) {
    const response = await worker.fetch(reportRequest(source));
    assert.equal(response.status, 400, source);
  }
  assert.equal(fetch.mock.calls.length, 0);
});

test("redirects cannot turn a GitHub attachment into an arbitrary proxy", async () => {
  for (const destination of [
    "http://127.0.0.1/secrets",
    "https://example.com/report.html",
    "https://objects.githubusercontent.com.evil.example/x",
    "https://user:secret@objects.githubusercontent.com/x",
  ]) {
    const fetch = mock.method(
      globalThis,
      "fetch",
      async () => new Response(null, { status: 302, headers: { Location: destination } }),
    );
    const response = await worker.fetch(reportRequest());
    assert.equal(response.status, 502, destination);
    assert.equal(fetch.mock.calls.length, 1);
    fetch.mock.restore();
  }
});

test("redirect loops stop after a bounded number of requests", async () => {
  const fetch = mock.method(
    globalThis,
    "fetch",
    async () => new Response(null, { status: 302, headers: { Location: STORAGE } }),
  );
  assert.equal((await worker.fetch(reportRequest())).status, 502);
  assert.equal(fetch.mock.calls.length, 4);
});

test("asset uploads may serve HTML with a generic download content type", async () => {
  for (const html of [
    HTML,
    `<!-- visual proof -->\n${HTML}`,
    `\ufeff <!-- ${"capture metadata ".repeat(100)} -->\n<!-- second comment -->\n${HTML}`,
  ]) {
    const fetch = mock.method(
      globalThis,
      "fetch",
      async () => new Response(html, { headers: { "Content-Type": "application/octet-stream" } }),
    );
    const response = await worker.fetch(reportRequest(ASSET));
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new TextEncoder().encode(html));
    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
    fetch.mock.restore();
  }
});

test("non-HTML and empty attachments produce a visible error in the report frame", async () => {
  for (const [body, type] of [
    ["PNG", "image/png"],
    ["binary data", "application/octet-stream"],
    ["", "text/html"],
  ]) {
    const fetch = mock.method(
      globalThis,
      "fetch",
      async () => new Response(body, { headers: { "Content-Type": type } }),
    );
    const response = await worker.fetch(reportRequest(ASSET));
    assert.equal(response.status, 415);
    assert.match(await response.text(), /role="alert"/);
    assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'self'/);
    fetch.mock.restore();
  }
});

test("a non-HTML upload with many comments is rejected in bounded time", () => {
  const source = `
    import worker from ${JSON.stringify(new URL("../src/worker.js", import.meta.url).href)};
    globalThis.fetch = async () => new Response("<!-- proof -->".repeat(512) + "not HTML", {
      headers: { "Content-Type": "application/octet-stream" }
    });
    const response = await worker.fetch(new Request(${JSON.stringify(reportRequest(ASSET).url)}));
    if (response.status !== 415) process.exit(1);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8",
    timeout: 2000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test("size limits apply both to declared lengths and streaming bodies", async () => {
  for (const declared of [true, false]) {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(declared ? 1 : 8 * 1024 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetch = mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(body, {
          headers: {
            "Content-Type": "text/html",
            ...(declared ? { "Content-Length": String(8 * 1024 * 1024 + 1) } : {}),
          },
        }),
    );
    const response = await worker.fetch(reportRequest());
    assert.equal(response.status, 413);
    assert.equal(cancelled, true);
    fetch.mock.restore();
  }
});

test("upstream failures are explained without disclosing signed redirect URLs", async () => {
  const fetch = mock.method(
    globalThis,
    "fetch",
    async () => new Response("upstream detail", { status: 404 }),
  );
  const missing = await worker.fetch(reportRequest());
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /without signing in/);
  fetch.mock.restore();
  mock.method(globalThis, "fetch", async () => {
    throw new Error(`Fetch failed: ${STORAGE}`);
  });
  const failed = await worker.fetch(reportRequest());
  assert.equal(failed.status, 502);
  assert.doesNotMatch(await failed.text(), /X-Amz|temporary|upstream detail/);
});

test("the service has a usable home page and supports read-only HTTP methods", async () => {
  const root = await worker.fetch(new Request("https://preview.example/"));
  assert.equal(root.status, 200);
  assert.match(await root.text(), /GitHub attachment link/);
  const head = await worker.fetch(new Request("https://preview.example/", { method: "HEAD" }));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const post = await worker.fetch(new Request("https://preview.example/", { method: "POST" }));
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");
  assert.equal((await worker.fetch(new Request("https://preview.example/unknown"))).status, 404);
});
