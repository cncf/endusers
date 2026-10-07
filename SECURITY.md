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
in this repository. [Dependabot](.github/dependabot.yml) opens pull requests for
routine npm and GitHub Actions version updates, and
[CodeQL](.github/workflows/codeql.yml) scans the JavaScript/TypeScript source on
pushes to main, pull requests, and a weekly schedule. Report all vulnerabilities
in third-party dependencies here, including ones with no fixed version available
yet.

## Known unpatched dependency advisories

`npm audit` currently reports 28 high-severity packages. They all resolve to the
single advisory below, and every other entry is transitive bubbling from it. The
package is already at its newest published version, so there is no upgrade to
apply and Dependabot has nothing to offer:

| Advisory                                                                 | Package  | Installed | Reached through                                |
| ------------------------------------------------------------------------ | -------- | --------- | ---------------------------------------------- |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | `braces` | 3.0.3     | `@docusaurus/utils` globbing, via `micromatch` |

It is build-time only: `braces` glob patterns come from Docusaurus rather than
from submitted content, and the package is not bundled into the static output,
so the advisory is not reachable by a visitor to the published site.

**Do not run `npm audit fix --force` against this.** No patched version exists —
`3.0.3` is the newest release and the advisory's vulnerable range is `<= 3.0.3`
— so the command can only try to force-resolve the `@docusaurus/*` tree onto
incompatible versions, breaking the build without removing the advisory. Remove
this section once upstream publishes a fix and the dependency tree picks it up.

A second advisory, GHSA-ch52-4w7c-c8xp against `http-cache-semantics`, was
listed here until upstream published `4.3.0` — outside that advisory's
`<= 4.2.0` vulnerable range. The lockfile now resolves `4.3.0` and the advisory
no longer appears, which is why the count above dropped from 34 to 28. When an
entry here is said to have no fix, re-check the registry before trusting it: "no
patched version" is only true as of the day it was written.

CI enforces this table: `npm run check:audit` (`scripts/audit-gate.mjs`) fails
the build on any high or critical advisory other than the allowlisted ones
above, so a new lockfile advisory cannot land silently. When an advisory listed
here gains a patched release, apply the fix and remove both the table row and
the matching allowlist entry in `scripts/audit-gate.mjs` — a unit test keeps the
two in sync.
