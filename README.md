# GitHub preview

Open a public GitHub HTML attachment or versioned Gist file as an interactive webpage.
Reports stay on GitHub; this small Cloudflare Worker retrieves them on demand and displays them inside a sandboxed frame.

The hosted viewer is [github-preview.shakker.dev](https://github-preview.shakker.dev).

## Local development

Use Node.js 22 or newer and pnpm. Wrangler is a project dependency.

```sh
pnpm install
pnpm dev
```

Open `http://localhost:8787` and paste a public GitHub HTML source URL.
Local development does not require a Cloudflare login.
The viewer accepts:

- GitHub attachments at `https://github.com/user-attachments/files/<id>/<name>.html` (or `.htm`) and `https://github.com/user-attachments/assets/<uuid>`.
- Versioned Gist HTML files at `https://gist.githubusercontent.com/<owner>/<gist-id>/raw/<revision>/<name>.html` (or `.htm`).

Gist IDs must contain 20–32 hexadecimal characters, and revisions must contain exactly 40 hexadecimal characters.
Use the raw file URL pinned to its revision; Gist page links, unversioned raw URLs, and branch names are not accepted.

A direct preview link has this shape:

```text
https://<viewer-address>/?url=<URL-encoded GitHub HTML source URL>
```

Construct it with `new URLSearchParams({ url: sourceUrl })` rather than concatenating an unescaped source URL.
The viewer also provides a small form that constructs the link.

While viewing a report, use **Copy preview link** in the header to share it. If
clipboard access is unavailable, the viewer selects the link for you to copy
manually. The shared address contains only the viewer and validated source.

## PR preview button

Place the shared **Open preview** button above the screenshots and recording in a PR description or comment:

```markdown
[<img src="https://github-preview.shakker.dev/assets/open-preview-v1.png" alt="Open preview" width="158" height="32">](<your-preview-url>)
```

Replace `your-preview-url` with the encoded preview address described above.
The high-resolution PNG has transparent corners and works on light and dark GitHub backgrounds.
The image URL stays the same when the preview points to a different report or viewer.

Wrangler deploys the button from `public/` as a static asset; report requests still use the Worker.
Keep the versioned image available without changing its bytes; publish revised artwork under a new filename so existing PR buttons remain reliable.
The button uses Lucide icons; their [license notices](public/assets/lucide-license.txt) accompany the image.

## Cloudflare setup

1. Create a Cloudflare account or sign in at <https://dash.cloudflare.com>.
2. From this project directory, run:

   ```sh
   pnpm exec wrangler login
   pnpm exec wrangler whoami
   ```

   Wrangler opens a browser for authorization. Complete that browser flow on the
   machine running the command. `whoami` confirms which account is available;
   there is no need to copy a token into this project or chat.

3. `wrangler.jsonc` configures `github-preview.shakker.dev` as the Worker's custom domain.
   For another deployment, replace `routes[].pattern` with a hostname in an active Cloudflare zone owned by your account, or remove `routes` to use only a `workers.dev` address.
   When ready to publish the viewer, run:

   ```sh
   pnpm deploy
   ```

   Select the intended account if prompted. Wrangler prints the resulting
   `github-preview.<your-subdomain>.workers.dev` address and configured custom domain.
   Cloudflare creates the custom domain's DNS record and HTTPS certificate automatically.
   If the account has no Workers subdomain, follow Wrangler's setup prompt.
   The `workers.dev` address remains enabled so existing preview links keep working.

4. Open the deployed address with a real public HTML report, then use this
   address when generating preview links in your visual-proof skill.

Keep `.dev.vars`, `.env` files, and account credentials out of Git. This Worker
requires no secrets, storage bindings, or GitHub token.

Official instructions: [Wrangler login](https://developers.cloudflare.com/workers/wrangler/commands/general/#login)
and [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## Report contract

- Create a UTF-8 HTML document with inline CSS and JavaScript. Embed images and
  fonts as data URLs. Reports are limited to 8 MiB; large images or recordings
  can use absolute public GitHub attachment URLs.
- Upload the report using the existing GitHub attachment workflow or an authorized public Gist upload.
  Link the attachment URL or versioned raw Gist file URL through this viewer; the viewer does not upload or store artifacts.
- Keep the captured baseline, exact revision, scenario, and original evidence
  links in the report. Hosting a report does not verify its claims.
- Report JavaScript can operate on the report, but cannot access viewer storage
  or the surrounding page. External scripts, API requests, forms, and nested
  frames are blocked. Explicit source links can open in a separate tab.
- Source URLs must use HTTPS and one of the supported GitHub paths, without credentials, query parameters, fragments, encoded slashes, or control characters.
  Gist URLs must also omit explicit ports and pin a revision.
  Private attachments and arbitrary web URLs are not supported.
  Gist authors own approval for public sharing; the Worker fetches raw files anonymously without querying Gist visibility metadata or using a GitHub token.
  Gist responses served as `text/plain` must contain an HTML document preamble; this MIME type is not accepted for attachments.
  GitHub's temporary storage redirects are resolved afresh on each request, bounded by a timeout and a response-size limit.
- If GitHub removes the source, its preview becomes unavailable.
  The original source is the authoritative copy.

Use a dedicated viewer hostname; keep it separate from applications that hold
user credentials. The response sandbox also applies when `/render` is opened
directly. Each preview response uses `Cache-Control: no-store`.

## Checks

```sh
pnpm check
pnpm test
pnpm build
```

`pnpm build` runs Wrangler's deployment dry run and writes disposable output to
`.artifacts/build`. It does not publish the Worker.
