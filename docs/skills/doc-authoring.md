---
unlisted: true
---

# Skill: Documentation Authoring

Guidelines for technical documentation within this repository.

## Standards

- **Audience**: CNCF end users (adopters), never project contributors; contributor
  material belongs on contribute.cncf.io.
- **Format**: CommonMark/GFM. No emojis.
- **Header hygiene**: Unique H1 per file. Incremental H2-H4.
- **Front matter**: `title` is required; use `description`, `sidebar_position`, and
  `slug` as needed. `hide_table_of_contents: true` hides the right sidebar.
- **Links**: Prefer relative internal links. External links must be verified before
  publishing. Broken links fail the build (`onBrokenLinks: 'throw'`).
- **Facts**: Verify CNCF facts against authoritative sources (cncf/tab,
  cncf/architecture, cncf/landscape, cncf.io announcements). Never assert counts or
  winners from memory.

## Organization

- `docs/practitioners/`: The site homepage (slug `/`). Single page, no sidebars.
- `docs/architectures/`: Reference architecture catalog. Generated pages are imported
  by `npm run import:architectures`; do not hand-edit imported architecture pages.
- `docs/community/`: The End User TAB, Governance, User Groups, Technical
  Community Groups, Awards, and Members — plus engagement pathways.
- `docs/metrics/`: The metrics dashboard, rendered from `data/metrics.json`.
- `docs/events/`: End user events at KubeCon + CloudNativeCon.
- Moved pages keep an `unlisted: true` stub at the old slug pointing to the new home
  (see `docs/resources/index.md` and `docs/awards/index.md`).

## Constraints

- No duplication of facts; use cross-references.
- Keep sections concise (max 300 words per section).
- Generated data (`data/metrics.json`, `data/architectures/`) is never edited by hand;
  change the collector scripts instead.
