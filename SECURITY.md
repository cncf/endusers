# Security Policy

## Supported Versions

This repository is a continuously deployed website — only the `main` branch
receives fixes, including security fixes.

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

- Use [GitHub private vulnerability reporting](../../security/advisories/new) to
  file a confidential report, or
- If private reporting is unavailable to you, email
  [projects@cncf.io](mailto:projects@cncf.io) with the subject prefix
  `[SECURITY]` to report vulnerabilities to the CNCF security team.

Include a description of the issue, steps to reproduce, and the potential
impact. You can expect an acknowledgement within a few days; the project is
maintained by volunteers, so timelines for fixes vary with severity.

## Scope

This policy covers the site source, build scripts, and GitHub Actions workflows
in this repository. [Dependabot](.github/dependabot.yml) opens pull requests for
routine npm and GitHub Actions version updates, but this repository has no
automated vulnerability scanning (no CodeQL or SAST workflow). Report all
vulnerabilities in third-party dependencies here, including ones with no fixed
version available yet.
