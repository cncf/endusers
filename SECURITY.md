# Security Policy

## Supported Versions

This repository is a continuously deployed website — only the `main` branch
receives fixes, including security fixes.

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

- Use
  [GitHub private vulnerability reporting](https://github.com/cncf/endusers/security/advisories/new)
  to file a confidential report, or
- If private reporting is unavailable to you, email
  [projects@cncf.io](mailto:projects@cncf.io) with the subject prefix
  `[SECURITY]` to report vulnerabilities to the CNCF security team.

Include a description of the issue, steps to reproduce, and the potential
impact. You can expect an acknowledgement within a few days; the project is
maintained by volunteers, so timelines for fixes vary with severity.

## Scope

This policy covers the site source, build scripts, and GitHub Actions workflows
and composite actions (`.github/actions/`) in this repository.
[Dependabot](.github/dependabot.yml) opens pull requests for routine npm, GitHub
Actions and dev container version updates, Dependabot security updates are
enabled for npm advisories, and [CodeQL](.github/workflows/codeql.yml) scans the
JavaScript/TypeScript source and the GitHub Actions workflows and composite
actions (the `actions` language) on pushes to main, pull requests that touch
either, and a weekly schedule. Report all vulnerabilities in third-party
dependencies here, including ones with no fixed version available yet.

Imported architecture pages and diagrams pass allowlist gates before they are
published: an SVG element, attribute or namespace, an MDX node type or element,
or a URL scheme that is not explicitly listed is rejected or stripped.
[CONTENT-SECURITY.md](CONTENT-SECURITY.md) lists every allowlist and the
residual risks. A way to publish anything outside those lists is in scope.

## Response headers

The site is served by Netlify, and [`netlify.toml`](netlify.toml) sets every
security response header; Netlify adds none of its own.

- **Every page (`/*`)**: a complete `Content-Security-Policy` (`default-src`,
  `script-src`, `style-src`, `img-src`, `font-src`, `connect-src`,
  `frame-src 'none'`, `media-src 'none'`, `manifest-src`, `object-src 'none'`,
  `base-uri`, `form-action`, `frame-ancestors 'self'` and
  `upgrade-insecure-requests`), a `Permissions-Policy` that turns off powerful
  browser features the site does not use (camera, microphone, geolocation,
  payment, USB and others), `Strict-Transport-Security`,
  `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: same-origin`.
- **Static images and favicons (`/img/*`, `/favicons/*`)**: the same headers,
  with a CSP that denies script and every fetch except inline styles, `data:`
  images and same-origin fonts, so an SVG opened directly renders inert.

`script-src` and `style-src` allow `'unsafe-inline'` because Docusaurus emits an
inline color-mode bootstrap script and inline styles on every page, and the
script's content varies with each deploy URL, so a hash cannot cover it. Both
still refuse every off-origin script and stylesheet. The page policy restates
the `<meta>` policy in `docusaurus.config.js`, which the dev server and other
hosts use. `tests/netlify-publish-contract.test.mjs` fails if the two drift
apart, or if a block that sends a CSP omits `default-src`, `object-src 'none'`,
`base-uri`, `form-action` or `frame-ancestors`.
[CONTENT-SECURITY.md](CONTENT-SECURITY.md) explains how these headers back up
the import gates.

## Known unpatched dependency advisories

`npm audit` currently reports no high-severity advisory without a fix, so the
table is empty and `ALLOWLISTED_ADVISORIES` in `scripts/audit-gate.mjs` holds
no entries:

| Advisory | Package | Installed | Reached through |
| -------- | ------- | --------- | --------------- |

Two advisories previously listed here were retired once their premise expired.
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
(`braces <= 3.0.3`, reached through `@docusaurus/utils` globbing via
`micromatch`, build-time only) was withdrawn upstream on 2026-10-23, so
`npm audit` no longer reports it. GHSA-ch52-4w7c-c8xp against
`http-cache-semantics` was listed until upstream published `4.3.0` — outside
that advisory's `<= 4.2.0` vulnerable range. When an entry here is said to
have no fix, re-check the registry before trusting it: "no patched version"
is only true as of the day it was written.
`npm run check:audit` now re-checks it for you on every run, in both of the ways
such a claim can expire. Once an allowlisted advisory stops appearing in the
lockfile, the gate fails and names the entry to remove from both
`scripts/audit-gate.mjs` and the table above. And once npm reports a fix for an
advisory that is still in the lockfile — the more likely case, where upstream
publishes a patched release before this repository picks it up — the gate fails
with the release to upgrade to, so a stale "no patched version" claim cannot sit
here unnoticed the way GHSA-ch52-4w7c-c8xp did.

CI enforces this table: `npm run check:audit` (`scripts/audit-gate.mjs`) fails
the build on any high or critical advisory other than the allowlisted ones
above, so a new lockfile advisory cannot land silently. When an advisory listed
here gains a patched release, apply the fix and remove both the table row and
the matching allowlist entry in `scripts/audit-gate.mjs` — a unit test keeps the
two in sync.

A new advisory that does have a patched release turns the gate red on `main`
until the lockfile moves. Dependabot security updates open that lockfile bump,
and when it changes only `package-lock.json` with a patch or minor version
change, [`dependabot-automerge.yml`](.github/workflows/dependabot-automerge.yml)
queues it to merge once the required checks, including `npm run check:audit`,
pass (see "Low-risk merge classes" in [`GOVERNANCE.md`](GOVERNANCE.md)). Check
for that pull request before hand-filing a lockfile bump. A fix that needs a
`package.json` change or a major version still waits for a maintainer.
