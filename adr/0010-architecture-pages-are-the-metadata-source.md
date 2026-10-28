# ADR 0010: Architecture pages are the source of their catalog metadata

- **Status**: Accepted
- **Date**: 2026-10-27
- **Related**:
  [ADR 0008](./0008-scope-agent-findings-to-user-observable-change.md),
  [ADR 0009](./0009-refresh-generated-data-only-on-content-change.md)

## Context

A reference architecture on the site is a directory, `docs/architectures/<id>/`,
holding its page (`index.md`) and its diagrams (`images/`). Until this decision
its metadata lived somewhere else entirely: a per-architecture
`data/architectures/records/<id>.json` and a second copy of the same fields in
`data/architectures/catalog.json`, which the catalog component, the member
directory generator and the data-link checks read. A contract test required the
two JSON copies to agree, and the content-security validator required every page
to have a record and every record a page.

The page itself carried only `title` and `sidebar_label`. The organization,
summary, industries, tags, projects, source attribution, dates and asset list
that describe it on `/architectures` were invisible from the page, and nothing
in the page said where they were.

That is the wrong shape for a catalog that invites contributions. A practitioner
adding or editing an architecture finds the page by its URL, edits it, and has
no reason to know that three other files describe it. The existing pages were
imported by maintainers and the submission workflow writes all four files at
once, so the arrangement held only as long as nobody else touched it. The first
hand-authored contribution would have shipped a page the catalog did not list,
or a record the page contradicted, and the validator would have reported it in
terms of files the contributor never opened.

Two things about the existing fields made a single source possible. The `assets`
list in every record was exactly the sorted listing of its `images/` directory,
so it was derived data written by hand. And `id` was always the directory name,
so it was too.

## Decision drivers

- One place to write an architecture's metadata, and that place is the page a
  contributor is already editing.
- The consumers of the catalog (the React component, `generate-members`, the
  data-link checks) keep reading one JSON file; a change to where the data is
  authored must not spread into how it is read.
- Drift between the authored source and the generated mirror is caught in CI,
  not discovered on the production site.
- Derived fields are derived, not transcribed.

## Options considered

1. **Keep JSON as the source and add a validator that the page agrees with it.**
   Rejected: it keeps every file a contributor must know about and adds another
   error message about files they did not open.
2. **Build the catalog from front matter at site build time, with no committed
   JSON.** Rejected: `generate-members`, the data-link checks and the unit tests
   read `catalog.json` outside the Docusaurus build, and a generated file that
   exists only inside the build cannot be diffed in a pull request.
3. **Put the metadata in the page's front matter, generate the committed
   `catalog.json` from it, and fail `validate:architectures` when the two
   disagree.** Chosen.

Within option 3, the metadata is nested under one `architecture:` key rather
than written as top-level front matter fields. Docusaurus gives meaning to
several of the field names the catalog uses (`tags` in particular creates tag
pages), and a nested block keeps the catalog's vocabulary out of the theme's.

## Decision

- The front matter of `docs/architectures/<id>/index.md` is the only place an
  architecture's metadata is written. Alongside `title`, an `architecture:`
  block carries `organization`, `summary`, `industries`, `tags`, `projects`,
  `sourceUrl`, exactly one of `sourceCommit` or `sourceIssue`, `published` and
  `updated`.
- `id` is the directory name and `assets` is the sorted listing of regular files
  in `images/`. Neither is authored; both are derived when the catalog is
  generated.
- `data/architectures/catalog.json` is generated from the pages by
  `npm run generate:architectures` (`scripts/generate-architectures.mjs`, over
  `scripts/lib/architecture-frontmatter.mjs`) and committed, in the order the
  importer has always written it: by organization, then id.
- `npm run validate:architectures` validates each field on the page it was read
  from, rejects an unknown key under `architecture:`, and fails when the
  committed catalog is not what the pages generate, naming the generator as the
  fix. Comparison is of parsed records, so a `fix:format` refold is not drift.
- `data/architectures/records/` is removed. The submission importer writes the
  page's front matter and regenerates the catalog; it no longer writes a record
  file.

## Consequences

- A contributor adding an architecture creates one directory with a page and its
  images, fills in the `architecture:` block, and runs one command. The
  validator's messages name the page they edited.
- The catalog's consumers are unchanged; they continue to read `catalog.json`.
- A pull request that edits a page's metadata without regenerating the catalog
  fails the "Validate repository" check with a message that says what to run.
- The `summary` field was hand-written for four of the ten pages and taken from
  the first body paragraph for the rest; it is now visible and editable where
  the body is.
- Under [ADR 0008](./0008-scope-agent-findings-to-user-observable-change.md),
  this decision binds later findings about where architecture metadata lives. A
  proposal to reintroduce a second authored copy, or to make the committed
  catalog authoritative again, is a comment on this record, not a new issue.
