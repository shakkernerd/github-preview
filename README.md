# GitHub preview

Open a public GitHub HTML attachment as an interactive webpage. Reports stay on
GitHub; this small Cloudflare Worker retrieves them on demand and displays them
inside a sandboxed frame.

## Local development

Use Node.js 22 or newer and pnpm. Wrangler is a project dependency.

```sh
pnpm install
pnpm dev
```

Open `http://localhost:8787` and paste a public GitHub HTML attachment URL. Local
development does not require a Cloudflare login. The viewer accepts GitHub
`user-attachments/files/<id>/<name>.html` (or `.htm`) and
`user-attachments/assets/<uuid>` URLs.

A direct preview link has this shape:

```text
https://<viewer-address>/?url=<URL-encoded GitHub attachment URL>
```

Construct it with `new URLSearchParams({ url: attachmentUrl })` rather than
concatenating an unescaped attachment URL. The viewer also provides a small form
that constructs the link.

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

3. When ready to publish the viewer, run:

   ```sh
   pnpm deploy
   ```

   Select the intended account if prompted. Wrangler prints the resulting
   `github-preview.<your-subdomain>.workers.dev` address. If the account has no
   Workers subdomain, follow Wrangler's setup prompt. A custom domain is optional.

4. Open the deployed address with a real public HTML attachment, then use this
   address when generating preview links in your visual-proof skill.

Keep `.dev.vars`, `.env` files, and account credentials out of Git. This Worker
requires no secrets, storage bindings, or GitHub token.

Official instructions: [Wrangler login](https://developers.cloudflare.com/workers/wrangler/commands/general/#login)
and [workers.dev addresses](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

## Report contract

- Create a UTF-8 HTML document with inline CSS and JavaScript. Embed images and
  fonts as data URLs. Reports are limited to 8 MiB; large images or recordings
  can use absolute public GitHub attachment URLs.
- Upload the report using the existing GitHub attachment workflow. Link its
  GitHub URL through this viewer; the viewer does not upload or store artifacts.
- Keep the captured baseline, exact revision, scenario, and original evidence
  links in the report. Hosting a report does not verify its claims.
- Report JavaScript can operate on the report, but cannot access viewer storage
  or the surrounding page. External scripts, API requests, forms, and nested
  frames are blocked. Explicit source links can open in a separate tab.
- Source URLs must be public GitHub attachment URLs without credentials, query
  parameters, or fragments. Private attachments and arbitrary web URLs are not
  supported. GitHub's temporary storage redirects are resolved afresh on each
  request, bounded by a timeout and a response-size limit.
- If GitHub removes an attachment, its preview becomes unavailable. The original
  attachment is the authoritative copy.

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
