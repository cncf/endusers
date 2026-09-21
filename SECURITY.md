# Security Policy

## Supported Versions

This repository is a continuously deployed website — only the `main` branch
receives fixes, including security fixes.

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

- Use [GitHub private vulnerability reporting](../../security/advisories/new)
  to file a confidential report, or
- If private reporting is unavailable to you (for example, you have no GitHub
  account or are reporting on behalf of an organization), contact a
  maintainer listed in [MAINTAINERS.md](./MAINTAINERS.md) directly through
  their GitHub profile to arrange a private channel.

Include a description of the issue, steps to reproduce, and the potential
impact. You can expect an acknowledgement within a few days; the project is
maintained by volunteers, so timelines for fixes vary with severity.

## Scope

This policy covers the site source, build scripts, and GitHub Actions
workflows in this repository. Vulnerabilities in third-party dependencies
should also be reported here if no fixed version is available — Dependabot
and automated scanning handle routine dependency advisories.
