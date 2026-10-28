---
name: submission
description:
  Use when preparing a CNCF End User reference architecture submission issue
  from an external document or case study.
---

# Skill: Reference Architecture Submission

Procedures for agents preparing a CNCF End User Reference Architecture
submission from an external document or case study and structuring the
submission for human review.

## Context & Architecture Flow

The CNCF End User site accepts community reference architectures through GitHub
Issues filed using the template
`.github/ISSUE_TEMPLATE/reference-architecture.yml`.

When a maintainer reviews the issue and applies the `architecture-ready` label,
the GitHub Action `.github/workflows/architecture-submission.yml` executes:

1. Runs `npm run import:architecture-issue`
   (`scripts/import-architecture-issue.mjs`)
2. Parses the issue body sections (`### <Field Label>`)
3. Extracts metadata, projects table, and content fields
4. Mirrors CNCF project logos locally under the repository's static architecture
   image directory
5. Writes the catalog record `data/architectures/records/<id>.json`
6. Updates `data/architectures/catalog.json`
7. Generates the documentation page `docs/architectures/<id>/index.md`
8. Runs unit tests (`npm run test:unit`), formatting (`npm run fix:format`),
   validators (`npm run validate:architectures`,
   `npm run validate:architecture-assets`), and production build
   (`npm run build`)
9. Opens a pull request against `main` on branch
   `automation/architecture-issue-<number>`

If any verification step fails, the workflow comments on the issue with a link
to the failed run, removes the `architecture-ready` label, and waits for a
maintainer to correct the issue body and re-apply the label.

## Field Mapping Reference

The issue form defines the following fields by `id`:

| Field ID           | Type     | Required | Content & Formatting Rules                                                                        |
| :----------------- | :------- | :------- | :------------------------------------------------------------------------------------------------ |
| `org_name`         | input    | Yes      | Organization or team name.                                                                        |
| `org_url`          | input    | Yes      | Organization website (URL).                                                                       |
| `contact`          | input    | Yes      | Name or team handle. Can use git config `user.name`.                                              |
| `email`            | input    | No       | Contact email. Leave blank unless explicitly authorized (publicly listed).                        |
| `org_size`         | input    | No       | Total organization size.                                                                          |
| `user_size`        | input    | No       | Target user base / audience size.                                                                 |
| `industries`       | input    | Yes      | Comma-separated list of industries. Propose if not in source.                                     |
| `tags`             | input    | No       | Comma-separated list of relevant architectural tags.                                              |
| `projects`         | textarea | Yes      | CNCF projects, one per line: `Name \| Logo URL \| Using since \| Current version \| Description`. |
| `org_description`  | textarea | Yes      | Summary of the organization.                                                                      |
| `team_description` | textarea | No       | Team / entity context.                                                                            |
| `overview`         | textarea | Yes      | Architectural overview, goals, detailed systems, and principles.                                  |
| `why_projects`     | textarea | No       | Detailed rationale for project adoption.                                                          |
| `worked_well`      | textarea | No       | Practices, designs, and choices that succeeded.                                                   |
| `not_worked_well`  | textarea | No       | Friction, limitations, architectural compromises, and lessons.                                    |
| `glue`             | textarea | No       | Custom automation, orchestration scripts, or CLI tooling built.                                   |
| `evolution`        | textarea | No       | Historical evolution and iterations of the platform.                                              |
| `whats_next`       | textarea | No       | Upcoming roadmaps, migrations, and next milestones.                                               |

## Rules for Agents Preparing Submissions

1. **Verify CNCF Project Eligibility & Artwork**:
   - Only projects currently graduated, incubating, or sandbox within the CNCF
     belong in `projects`.
   - Sister LF projects (e.g., OCI or software supply chain security
     initiatives) or upstream container projects (e.g., Podman) must be
     documented in `why_projects` or `overview`, not listed as CNCF projects.
   - For every project in `projects`, verify its color icon in `cncf/artwork`
     via `gh api repos/cncf/artwork/contents/projects/<slug>/icon/color`.
   - Formatted line:
     `Name | https://raw.githubusercontent.com/cncf/artwork/main/projects/<slug>/icon/color/<slug>-icon-color.svg | Using since | Current version | Description`.

2. **Subheadings Inside Fields Must Use `####` or Deeper**:
   - GitHub issue forms format every field response under a top-level
     `### <Field Label>` heading, and `scripts/import-architecture-issue.mjs`
     splits the issue body on lines matching `^###` followed by a space.
   - Any section in the source document that has no dedicated field in the form
     should be included inside `overview` under `####` headings or deeper. Never
     use `###` inside a field body, as it will break the section parser.
3. **URL Prefill Budget & Limits**:
   - GitHub issue template query URLs have practical length limits (~6,000
     characters). Full reference architectures (~25 KB+) will return HTTP 414
     (URI Too Long) or HTTP 500 if prefilled entirely via URL.
   - Pack short required and metadata fields into the URL query parameters.
   - Place large body sections (`overview`, `why_projects`, `worked_well`,
     `not_worked_well`) into a local helper HTML file
     (`~/Downloads/<name>-architecture-paste.html`) with Copy buttons for the
     human submitter.

4. **Never Submit Directly**:
   - Agents must never submit the issue.
   - Hand off to the human maintainer by opening the prefilled form and the
     helper tab in their local browser.
