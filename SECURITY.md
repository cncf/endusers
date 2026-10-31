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

This section is the register of high or critical `npm audit` advisories that
`scripts/audit-gate.mjs` allowlists because no patched release exists upstream.
It is currently empty: `npm audit` reports no high or critical advisory, and
`ALLOWLISTED_ADVISORIES` in `scripts/audit-gate.mjs` has no entries.

When one has to be added, record it as a table row here with the advisory,
package, installed version and the path it is reached through, plus a note on
whether it is build-time only or reachable from the published site, and add the
matching entry to `ALLOWLISTED_ADVISORIES`. Do not run `npm audit fix --force`
against an advisory with no patched version: the command can only try to
force-resolve the dependency tree onto incompatible versions, breaking the build
without removing the advisory.

Two advisories have been listed here and retired. GHSA-ch52-4w7c-c8xp against
`http-cache-semantics` left when upstream published `4.3.0`, outside its
`<= 4.2.0` vulnerable range. GHSA-vfj7-8cjw-p6xm against `braces` left on
2026-10-23 when GitHub withdrew the advisory; `braces` is still at `3.0.3`, but
`npm audit` no longer reports it. When an entry here is said to have no fix,
re-check the registry before trusting it: "no patched version" is only true as
of the day it was written. `npm run check:audit` re-checks it for you on every
run, in both of the ways such a claim can expire. Once an allowlisted advisory
stops appearing in the lockfile, the gate fails and names the entry to remove
from both `scripts/audit-gate.mjs` and the table here. And once npm reports a
fix for an advisory that is still in the lockfile — the more likely case, where
upstream publishes a patched release before this repository picks it up — the
gate fails with the release to upgrade to, so a stale "no patched version" claim
cannot sit here unnoticed the way GHSA-ch52-4w7c-c8xp did.

CI enforces this register: `npm run check:audit` (`scripts/audit-gate.mjs`)
fails the build on any high or critical advisory other than the allowlisted
ones, so a new lockfile advisory cannot land silently. Moderate and low
advisories do not block on their own, but the gate also fails when one of them
has a patched release reachable without a semver-major change, so a fix that is
one `npm audit fix --package-lock-only` away (typically an `overrides` floor
that no longer reaches the patched release) cannot sit under the threshold
indefinitely. Because npm's `fixAvailable` flag is a prediction (npm 10
reports a fix for an advisory whose vulnerable range still covers every
published release), the gate first runs `npm audit fix --package-lock-only` on
a scratch copy of the lockfile and only fails when the named package actually
moves; a finding the fix cannot apply is logged as a warning instead. When an
advisory listed here gains a patched release, apply the
fix and remove both the table row and the matching allowlist entry in
`scripts/audit-gate.mjs` — a unit test keeps the two in sync.

When the fix for an advisory is an `overrides` entry in `package.json` — lifting
a package onto a patched release its dependents' declared ranges cannot reach —
write the entry as a floor (`^x.y.z`), never an exact version. npm reads a bare
version as an exact pin: the ceiling as well as the floor. Both automated
remediation paths below resolve only inside the range `package.json` allows, so
a pinned override leaves them no room and opts that package out of automatic
patching the next time it carries an advisory — the fix then waits for a
maintainer, which is what the override was meant to avoid (#1941).

A new advisory that does have a patched release turns the gate red on `main`
until the lockfile moves — and within a day: the scheduled "Dependency audit"
workflow
([`.github/workflows/audit-schedule.yml`](.github/workflows/audit-schedule.yml))
re-runs `npm run check:audit` on `main` daily, because the advisory database
moves on its own while a quiet lockfile changes nothing. The red run is the
notification; that workflow opens nothing. When
`npm audit fix --package-lock-only` can resolve every gated advisory inside the
ranges `package.json` already allows, the "Dependency audit fix" workflow
([`.github/workflows/audit-fix.yml`](.github/workflows/audit-fix.yml)) runs it,
re-checks the gate and the unit tests on the result, and opens a lockfile-only
pull request from the `automation/audit-fix` branch. That pull request is not
Dependabot-authored, so `dependabot-automerge.yml` does not queue it: a
maintainer merges it by hand under the normal review rules, and closes and
reopens it (or pushes to it) to start CI, which a workflow-token pull request
does not trigger. When the patched release falls outside the ranges, the job
fails and the red scheduled run stays the notification, as before. Dependabot
security updates open the same lockfile bump, and when it changes only
`package-lock.json` with a patch or minor version change,
[`dependabot-automerge.yml`](.github/workflows/dependabot-automerge.yml) queues
it to merge once the required checks, including `npm run check:audit`, pass (see
"Low-risk merge classes" in [`GOVERNANCE.md`](GOVERNANCE.md)). Check for either
pull request before hand-filing a lockfile bump. A fix that needs a
`package.json` change or a major version still waits for a maintainer.

## Accepted moderate-risk advisories

The register above lists high and critical advisories the audit gate
suppresses. Moderate advisories never trip that gate, so they need no
allowlist entry — but one with no reachable fix still deserves a written
decision. This section records the moderate advisories the project has
reviewed and accepted. An entry here changes nothing in CI: it records the
reasoning so the Dependabot security-update runs that keep failing on it are
understood, and states what would make the acceptance expire.

| Advisory                                                                 | Package     | Installed                    | Reached through                                                                                 | Exposure                                                                                                                                          |
| ------------------------------------------------------------------------ | ----------- | ---------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | `minimatch` | 3.1.5 (6 copies), 10.2.6 (1) | `serve-handler` (exact pin), `@stryker-mutator/*`, `markdownlint-cli`, `eslint` and its plugins | Build-time and developer tooling only — every glob pattern `minimatch` reads here is authored in this repository, not supplied by untrusted input |

GHSA-g3hv-75wg-m249 is a denial of service via glob-pattern amplification,
patched only in `minimatch` 11.0.1 — outside every consumer's declared
range, so Dependabot security updates for it fail with
`security_update_not_possible`. Accepted in #2036. The acceptance expires
when the eslint plugin chain (and ideally `serve-handler` and
`@stryker-mutator/*`) widens its ranges to accept `minimatch` ^11: then add
`"minimatch": "^11.0.1"` to the `overrides` block in `package.json` (a
floor, per the override rule above), verify `npm run check:lint` and
`npm run test:unit` both pass, and remove this row. Forcing the override
today crashes `eslint-plugin-jsx-a11y` (`_minimatch.default is not a
function`), so accepting the moderate risk is preferred over weakening lint
coverage.
