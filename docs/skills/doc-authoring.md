---
unlisted: true
---

# Skill: Documentation Authoring

Guidelines for technical documentation within this repository.

## Standards

- **Audience**: CNCF end users (adopters), never project contributors;
  contributor material belongs on contribute.cncf.io.
- **Format**: CommonMark/GFM. No emojis.
- **Header hygiene**: Unique H1 per file. Incremental H2-H4.
- **Front matter**: `title` is required; use `description`, `sidebar_position`,
  and `slug` as needed. `hide_table_of_contents: true` hides the right sidebar.
- **Links**: Prefer relative internal links. External links must be verified
  before publishing. Broken links fail the build (`onBrokenLinks: 'throw'`).
- **Facts**: Verify CNCF facts against authoritative sources (cncf/tab,
  cncf/architecture, cncf/landscape, cncf.io announcements). Never assert counts
  or winners from memory.

## Organization

- `docs/practitioners/`: The site homepage (slug `/`). Single page, no sidebars.
- `docs/architectures/`: Reference architecture catalog (`index.md`) and the
  submission guide (`submit.md`), the only two pages in its sidebar. The other
  pages are generated from submission issues by
  `.github/workflows/architecture-submission.yml` and then committed; register
  any new hand-authored page in `REPO_AUTHORED_PAGES`
  (`scripts/lib/architecture-pages.mjs`) so the content-security gate treats it
  as repo-authored.
- `docs/community/`: The End User TAB, Governance, User Groups, Technical
  Community Groups, Awards, and Members — plus engagement pathways.
- `docs/resources/metrics.md`: The metrics dashboard, rendered from
  `data/metrics.json`.
- `docs/events/`: End user events at KubeCon + CloudNativeCon.
- `docs/resources/`: Case studies and Technology Radar reports, rendered from
  `data/case-studies.json` and `data/radar-reports.json` (see the data
  contribution model in CONTRIBUTING.md); do not hand-edit generated listings.
- When a page moves, update every in-repo link to the new route rather than
  leaving a stub at the old slug; the build's broken-link check
  (`onBrokenLinks: 'throw'`) catches anything missed.

## Constraints

- No duplication of facts; use cross-references.
- Keep sections concise (max 300 words per section).
- Generated data (`data/metrics.json`, `data/architectures/`) is never edited by
  hand; change the collector scripts instead.
