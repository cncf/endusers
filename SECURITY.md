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

`npm audit` currently reports 34 high-severity packages. They resolve to the two
advisories below, and every other entry is transitive bubbling from them. Both
packages are already at their newest published version, so there is no upgrade
to apply and Dependabot has nothing to offer:

| Advisory                                                                 | Package                | Installed | Reached through                                         |
| ------------------------------------------------------------------------ | ---------------------- | --------- | ------------------------------------------------------- |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | `braces`               | 3.0.3     | `@docusaurus/utils` globbing, via `micromatch`          |
| [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) | `http-cache-semantics` | 4.2.0     | `@docusaurus/core` version check, via `update-notifier` |

Both are build-time only. `braces` glob patterns come from Docusaurus rather
than from submitted content, and `update-notifier` makes an unauthenticated
npm-registry request that carries no repository secret. Neither package is
bundled into the static output, so neither advisory is reachable by a visitor to
the published site.

**Do not run `npm audit fix --force` against these.** No patched version exists
for either package, so the command can only try to force-resolve the
`@docusaurus/*` tree onto incompatible versions — breaking the build without
removing the advisories. Remove this section once upstream publishes fixes and
the dependency tree picks them up.
