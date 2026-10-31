# ADR 0012: Event pages are the source of the events section

- **Status**: Accepted
- **Date**: 2026-10-31
- **Related**:
  [ADR 0008](./0008-scope-agent-findings-to-user-observable-change.md),
  [ADR 0010](./0010-architecture-pages-are-the-metadata-source.md),
  [ADR 0011](./0011-content-focused-validation-for-documentation.md)

## Context

The events section is one page, `docs/events/index.md`, with an "Upcoming" and
a "Past" heading. Every event the community has gathered at is a `###` heading
under one of the two, written in prose, with its dates in a bolded dateline. The
page states that it is reviewed quarterly so it never shows a past event as
upcoming, and `tests/events-page.test.mjs` enforces that promise against the
wall clock: when the last upcoming event ends, the suite goes red until someone
moves the entry under "Past".

That shape served two events. It does not serve a growing list. Each
conference pushes the previous one further down a single page; a reader looking
for last year's End User Summit scrolls past this year's 83-talk schedule to
reach it; an event has no URL of its own to share or to link from a blog post;
and the only structure the page has is the Upcoming/Past split, which a static
site cannot keep true between deploys and which a maintainer has to flip by
hand after every conference.

The site already has a pattern for a section whose entries are pages with
metadata: [ADR 0010](./0010-architecture-pages-are-the-metadata-source.md)
makes each architecture page's front matter the source of its catalog record.
Events are the same shape, with one difference that matters here: nothing
outside the Docusaurus build reads an events catalog. The architecture catalog
is committed as JSON because `generate-members`, the data-link checks and the
unit tests consume it outside the build. An events list has no such consumer.

## Decision drivers

- A reader opening `/events` sees the current year's events, latest first, and
  reaches any earlier event from the sidebar in one click.
- Adding an event is one Markdown file, on the document-only CI path of
  [ADR 0011](./0011-content-focused-validation-for-documentation.md), with no
  generated file to regenerate and no second copy to keep in step.
- Ordering is computed from dates, in one place, for both the index and the
  sidebar, so the two can never disagree.
- Nothing on the page claims a time-dependent fact ("upcoming") that a static
  build cannot keep true.

## Options considered

1. **One page per year, sidebar items as anchors.** Rejected: a year page grows
   without bound as the talk schedule and photos accumulate, an event still has
   no URL of its own, and anchor sidebar items must be hand-listed because the
   docs sidebar cannot autogenerate them.
2. **A committed `data/events.json` with hand-written pages, like awards and
   members.** Rejected: a second authored copy of each event's dates and
   location, with a validator to keep it aligned, for data that has no consumer
   outside the build.
3. **Front matter as the source with a generated, committed catalog, like
   ADR 0010.** Rejected for the same reason: the generated file would have no
   reader except the build that could have read the front matter directly, and
   every event PR would carry a regenerated JSON diff.
4. **Docusaurus generated-index category pages.** Rejected: the built-in card
   shows only title and description, so dates and location would have to be
   written into the description as prose, and the `/events` slug would have to
   be moved between year directories by hand each January.
5. **One page per event; one Node library reads the front matter and feeds
   both the docs sidebar and a local plugin's global data; a React component
   renders the index from that data.** Chosen.

## Decision

### Content model

- An event is a Markdown page at `docs/events/<year>/<slug>.md`, served at
  `/events/<year>/<slug>`. The year directory is the only grouping; it has no
  `_category_.json`, and its label is the directory name.
- Alongside `title` and `description`, each page carries an `event:` block:

  ```yaml
  event:
    start: 2026-11-09
    end: 2026-11-12
    location: Salt Lake City, Utah
    url: https://events.linuxfoundation.org/kubecon-cloudnativecon-north-america/
  ```

  `start` and `end` are ISO calendar dates with `end >= start`; `location` and
  `url` are required; the year directory equals the year of `start`. The
  metadata is nested under one key, as ADR 0010 does, to keep the vocabulary out
  of the theme's own front matter.

- `description` is both the page's meta description and its summary on the
  index.
- The page body is free prose. Data-driven embeds such as `<EndUserTalkSchedule />`
  stay in the body of the page they describe.
- `docs/events/index.md` keeps its intro paragraph and renders `<EventsIndex />`.
  It no longer carries event entries, datelines, an Upcoming/Past split or a
  "Last verified" note.

### One reader

- `scripts/lib/events-catalog.mjs` is the only code that reads event front
  matter. `collectEvents(docsDir)` walks `docs/events/<year>/*.md`, parses the
  front matter with the `yaml` dependency already used for architectures,
  validates the rules above, and returns the events sorted by `start`
  descending, then `end` descending, then `title`. `groupByYear(events)` returns
  `[{ year, events }]` newest year first.
- A rule violation throws an error naming the file and the rule, so a bad page
  fails `npm run build` and the unit suite with a message about the file the
  author edited.

### Two consumers

- `sidebars.js` builds `eventsSidebar` from the library: the index doc first,
  then one collapsible category per year, newest first, each holding its event
  docs in catalog order. The newest year is expanded; older years are
  collapsed. Events therefore stop being a single-page section; the comment in
  `sidebars.js` and the agent instructions that list it as one are updated.
- `scripts/lib/events-catalog-plugin.mjs` is a local Docusaurus plugin
  registered in `docusaurus.config.js`. Its `loadContent` calls
  `collectEvents`, its `contentLoaded` publishes `{ years }` with
  `setGlobalData`, and its `getPathsToWatch` returns the event pages so the dev
  server reloads the index when one changes. It lives under `scripts/lib/`
  rather than `src/` because it runs in Node at config load and never ships to
  the browser, which the end-to-end coverage lane requires of every `src/`
  file.
- `src/components/EventsIndex/` reads the plugin data with `usePluginData` and
  renders the newest year: a heading naming the year, then a list of rows, each
  with the date range in a `<time>` element carrying the start date, the title linking to the
  page through `<Link>`, the location and the description. Below the list, an
  "Earlier years" line links to each older year's newest event; the sidebar
  carries the full list. A `formatDateRange(start, end)` helper beside the
  shared `formatDate` renders a range in the same UTC-pinned, long-form US
  style, collapsing a shared month ("November 9-12, 2026") and a single day
  ("November 9, 2026"). The component follows the `ui-standards` skill: theme
  variables, both color modes, semantic markup.

### Dates only

- There is no "Upcoming" or "Past" wording and no badge computed from the
  clock, at build time or in the browser. Every entry shows its dates; the
  latest-first order makes the newest obvious. The wall-clock staleness test is
  retired with the split it enforced.

### Content and CI

- The two events the page lists today move to `docs/events/2026/kubecon-na.md`
  (dateline, schedule links, `<EndUserTalkSchedule />`) and
  `docs/events/2025/kubecon-na.md` (End User Summit, End User Reception, archive
  links, the Michelin award figure). No further events are backfilled by this
  change; later events arrive as ordinary document pull requests.
- In `scripts/lib/content-only-ci.mjs`, `docs/events/index.md` stays
  data-backed (it renders plugin data) and `docs/events/2026/kubecon-na.md` is
  added (it embeds the talk schedule). Every other event page is an authored
  document on the focused path.
- `tests/events-catalog.test.mjs` (library rules and ordering, run against both
  fixtures and the live `docs/events/` tree) and the rewritten
  `tests/events-page.test.mjs` (index page front matter and `<EventsIndex />`,
  and asset and internal-link resolution for every page under `docs/events/`)
  join the focused-suite list in `.github/workflows/ci.yml`, as the list's
  guard requires of any suite that reads authored documents.
- `tests/events-index.test.mjs` covers the component through a `usePluginData`
  stub added to `tests/tools/docusaurus-stubs/`;
  `tests/events-sidebar-contract.test.mjs` asserts the generated
  `eventsSidebar` shape against the catalog; `tests/e2e/events.spec.js` is rewritten to
  derive its expectations from the event pages' front matter and to cover the
  index rows, the sidebar year groups, navigation to an event page and the hero
  image on the 2025 page. The new source files are held to the coverage and
  mutation gates like any other.
- The `doc-authoring` skill and the agent instructions gain a short note on
  adding an event page.

## Consequences

- A reader sees this year's events first and finds any earlier event under its
  year in the sidebar. Each event has a URL of its own.
- A contributor adds an event by creating one Markdown file with an `event:`
  block. The build and the unit suite report a malformed block against that
  file. No generated file is touched, so the pull request takes the
  document-only path unless the page embeds data-driven content.
- The order of events on the index and in the sidebar comes from one function,
  so they cannot drift apart; a page in the wrong year directory is a build
  failure, not a misfiled entry.
- The quarterly "move it to Past" chore and the test that reminded maintainers
  of it are gone. Nothing on the section claims an event is upcoming, so nothing
  becomes false between deploys.
- `/events/` keeps its URL; no redirects are needed. The two event pages are new
  routes.
- Under [ADR 0008](./0008-scope-agent-findings-to-user-observable-change.md),
  this decision binds later findings about the events section. A proposal to
  add a committed events catalog or validator script, to reintroduce an
  Upcoming/Past split or badge, or to report a past event "not marked as past"
  as a defect is a comment on this record, not a new issue.
