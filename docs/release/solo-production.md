# Solo production deployment — Cloudflare Pages

This release is a static, environment-free Vite build. Cloudflare Pages is the
deployment target because it serves `dist/` directly and does not require a
GitHub Project Pages base path.

## Build artifact

From a clean checkout:

```bash
npm ci
npm run verify
npm run build
```

Configure a Cloudflare Pages project with:

| Setting                | Value                                       |
| ---------------------- | ------------------------------------------- |
| Production branch      | the operator-approved release branch        |
| Build command          | `npm ci && npm run verify && npm run build` |
| Build output directory | `dist`                                      |
| Node version           | the current active LTS used by CI/operator  |

No client environment variables or server runtime are required. Do not put
credentials, Cloudflare API tokens, or secrets in Vite variables: anything
prefixed `VITE_` is shipped to the browser.

For a manual artifact deploy after a local build, authenticate the Cloudflare
CLI outside this repository, then run:

```bash
npx wrangler pages deploy dist --project-name <pages-project>
```

Use `--branch <staging-branch>` for a preview deployment. The operator must
record the resulting Pages URL in the release evidence.

## Cache and security headers

`public/_headers` is copied to `dist/_headers` by Vite and applied by
Cloudflare Pages:

- `index.html` is no-store so a new deployment loads its current entrypoint.
- Versioned `assets/models/*` glTF files cache for one year, immutable (use `models/v2/…` or a new content path when bytes change; never overwrite old immutable URLs with different content).
- Vite-hashed JavaScript and CSS under `/assets/` cache for one year, immutable.

Changing a versioned GLB requires a new directory or filename and an updated
manifest. Public textures and `assets/manifest.json` intentionally do not get
an immutable rule because their paths are not content-hashed.

The CSP permits only same-origin scripts, fetches, media, images, and workers;
`data:`/`blob:` are allowed only where Three.js and browser asset handling may
need them. It forbids plugins, framing, and inline/evaluated scripts. If a
future dependency needs an exception, document the exact directive and reason
before changing the policy.

## Production smoke

After a deployment is live, wait for the Pages URL to respond and run:

```bash
npm run test:smoke -- https://<deployment>.pages.dev
```

Also verify in Chromium that a patrol starts and that the Network panel returns
200 for `/assets/manifest.json` and at least one `/assets/models/v2/*.glb`
file. A missing or failed GLB must leave the procedural fallback playable.

## Rollback

In Cloudflare Pages, open **Deployments**, select the last known-good
production deployment, then choose **Rollback to this deployment**. This is
the preferred rollback because it restores the previous immutable artifact
without rebuilding.

If the console is unavailable, redeploy the previously approved commit/artifact:

```bash
git checkout <known-good-sha>
npm ci && npm run verify && npm run build
npx wrangler pages deploy dist --project-name <pages-project>
```

Run the production smoke command against the restored URL and record the
deployment ID, source commit, and smoke result in the release notes.
