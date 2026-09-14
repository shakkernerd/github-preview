const MAX_BYTES = 8 * 1024 * 1024;
const STORAGE_HOSTS = new Set([
  "objects.githubusercontent.com",
  "github-production-user-asset-6210df.s3.amazonaws.com",
  "github-production-repository-file-5c1aeb.s3.amazonaws.com",
]);
const MEDIA_SOURCES = [
  "https://github.com",
  ...[...STORAGE_HOSTS].map((host) => `https://${host}`),
].join(" ");
const SHELL_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
const REPORT_POLICY = [
  "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  `img-src data: blob: ${MEDIA_SOURCES}`,
  `media-src data: blob: ${MEDIA_SOURCES}`,
  "font-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");
const SOURCE_HELP =
  "Use a public GitHub HTML attachment URL: github.com/user-attachments/files/…/preview.html or github.com/user-attachments/assets/….";

class PreviewError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function attachmentUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new PreviewError(400, SOURCE_HELP);
  }
  const file = /^\/user-attachments\/files\/[1-9]\d*\/([^/]+\.html?)$/i.exec(url.pathname);
  const asset = /^\/user-attachments\/assets\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(
    url.pathname,
  );
  let filename = "";
  try {
    filename = file ? decodeURIComponent(file[1]) : "";
  } catch {
    throw new PreviewError(400, SOURCE_HELP);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (!file && !asset) ||
    /[\\/\x00-\x1f\x7f]/.test(filename)
  ) {
    throw new PreviewError(400, SOURCE_HELP);
  }
  return url;
}

function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );
}

function document(body, title = "GitHub preview") {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;font:15px/1.5 system-ui,sans-serif;background:light-dark(#fff,#17191d);color:light-dark(#22252b,#edf0f4)}
*{box-sizing:border-box}body{margin:0}a{color:inherit;text-underline-offset:3px}main{max-width:640px;margin:12vh auto;padding:24px}h1{font-size:28px;letter-spacing:-.7px;margin:0 0 12px}p{color:light-dark(#58616e,#abb4c2)}label{display:block;margin:24px 0 8px;font-weight:600}form>div{display:flex;gap:8px;flex-wrap:wrap}input,button{font:inherit;padding:12px;border:1px solid light-dark(#cdd3db,#434b58);border-radius:8px}input{flex:1;min-width:180px;background:transparent;color:inherit}button{cursor:pointer;background:light-dark(#242b36,#e6ebf3);color:light-dark(#fff,#17191d)}small{display:block;margin-top:16px;color:light-dark(#66717e,#abb4c2)}header{height:48px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 16px;border-bottom:1px solid light-dark(#dce0e6,#373f4b)}header>a:first-child{text-decoration:none;font-weight:600;white-space:nowrap}header>a:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}iframe{display:block;border:0;width:100%;height:calc(100dvh - 48px)}.error{color:light-dark(#a72d27,#ffb3ad)}
</style></head><body>${body}</body></html>`;
}

function landing(message = "") {
  return document(
    `<main><h1>Open a GitHub preview.</h1><p>View an HTML attachment in your browser, with its interactions intact.</p>${message ? `<p class="error" role="alert">${escapeHtml(message)}</p>` : ""}<form action="/" method="get"><label for="url">GitHub attachment link</label><div><input id="url" name="url" type="url" placeholder="https://github.com/user-attachments/…" required><button type="submit">Open preview</button></div></form><small>The report stays on GitHub. Public, self-contained HTML up to 8 MiB.</small></main>`,
  );
}

function viewer(source) {
  const path = `/render?${new URLSearchParams({ url: source.href })}`;
  return document(
    `<header><a href="/">GitHub preview</a><a href="${escapeHtml(source.href)}" target="_blank" rel="noopener noreferrer">Original on GitHub ↗</a></header><iframe title="GitHub HTML preview" src="${escapeHtml(path)}" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe>`,
  );
}

function htmlResponse(request, body, status = 200, policy = SHELL_POLICY) {
  return new Response(request.method === "HEAD" ? null : body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": "inline",
      "Content-Security-Policy": policy,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    },
  });
}

async function loadAttachment(source) {
  const signal = AbortSignal.timeout(15_000);
  let url = source;
  let response;
  for (let redirects = 0; redirects <= 3; redirects++) {
    // Requests to GitHub never inherit the visitor's cookies or authorization.
    response = await fetch(url.href, {
      redirect: "manual",
      signal,
      headers: { Accept: "text/html, application/octet-stream;q=0.9" },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (!location || redirects === 3)
      throw new PreviewError(
        502,
        "GitHub did not provide a usable attachment. Check the original link.",
      );
    const next = new URL(location, url);
    if (
      next.protocol !== "https:" ||
      next.port ||
      next.username ||
      next.password ||
      next.hash ||
      !STORAGE_HOSTS.has(next.hostname)
    ) {
      throw new PreviewError(
        502,
        "GitHub did not redirect to a supported attachment host. Check the original link.",
      );
    }
    url = next;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new PreviewError(
      response.status === 404 || response.status === 410 ? 404 : 502,
      "This attachment is unavailable. Check that the original GitHub link opens without signing in.",
    );
  }
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "text/html" && contentType !== "application/octet-stream") {
    await response.body?.cancel();
    throw new PreviewError(415, "This attachment is not an HTML report.");
  }
  if (Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel();
    throw new PreviewError(
      413,
      "This report exceeds 8 MiB. Keep large recordings as GitHub attachment links.",
    );
  }
  if (!response.body) throw new PreviewError(415, "The HTML attachment is empty.");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) {
        await reader.cancel();
        throw new PreviewError(
          413,
          "This report exceeds 8 MiB. Keep large recordings as GitHub attachment links.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!length) throw new PreviewError(415, "The HTML attachment is empty.");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (contentType === "application/octet-stream" && !isHtmlDocument(bytes)) {
    throw new PreviewError(415, "This attachment is not a complete HTML document.");
  }
  return bytes;
}

function isHtmlDocument(bytes) {
  const text = new TextDecoder().decode(bytes);
  const opening = /\s*(<!--|<!doctype\s+html\b|<html\b)/iy;
  let offset = 0;
  for (;;) {
    opening.lastIndex = offset;
    const match = opening.exec(text);
    if (!match) return false;
    if (match[1] !== "<!--") return true;
    const end = text.indexOf("-->", opening.lastIndex);
    if (end === -1) return false;
    offset = end + 3;
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Use GET or HEAD.", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    if (url.pathname !== "/" && url.pathname !== "/render")
      return htmlResponse(request, landing("This preview address does not exist."), 404);
    try {
      if (url.pathname === "/" && !url.searchParams.has("url"))
        return htmlResponse(request, landing());
      const source = attachmentUrl(url.searchParams.get("url"));
      if (url.pathname === "/") return htmlResponse(request, viewer(source));
      return htmlResponse(request, await loadAttachment(source), 200, REPORT_POLICY);
    } catch (error) {
      const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
      const status = error instanceof PreviewError ? error.status : timeout ? 504 : 502;
      const message =
        error instanceof PreviewError
          ? error.message
          : timeout
            ? "GitHub took too long to return the report. Try opening the preview again."
            : "The attachment could not be loaded from GitHub. Try again or check the original link.";
      if (url.pathname === "/render") {
        // Errors must remain visible inside the same sandbox as successful reports.
        return htmlResponse(
          request,
          document(
            `<main><h1>Preview unavailable</h1><p role="alert">${escapeHtml(message)}</p><a href="">Try again</a></main>`,
          ),
          status,
          REPORT_POLICY,
        );
      }
      return htmlResponse(request, landing(message), status);
    }
  },
};
