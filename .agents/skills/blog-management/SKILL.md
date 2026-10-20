---
name: blog-management
description:
  Use when creating, editing, or scheduling posts on the CNCF End User Community
  blog, including front matter, authors, and publishing cadence.
---

# Skill: Blog Management

Workflow for publishing posts on the CNCF End User Community blog.

## Creating a post

- File name: `blog/YYYY-MM-DD-slug.md`. The date prefix sets the publish date.
- Front matter: `slug`, `title`, `authors` (keys from `blog/authors.yml`), and
  `tags` (keys from `blog/tags.yml`). Do not invent authors or tags inline; add
  them to the YAML files first.
- Place `{/* truncate */}` after the opening paragraphs to control the feed
  excerpt. MDX v3 (used by Docusaurus 3.10+) rejects the legacy
  `<!-- truncate -->` HTML comment form; use the JSX comment syntax instead.
- Voice: warm, credible, aligned with CNCF's public voice. No emojis.
- Audience: end users. Frame stories around production experience and community
  participation, not project contribution mechanics.

## Validation

- `npm run build` must pass; broken links fail the build.
- Verify every external link and factual claim (award winners, counts, dates)
  against an authoritative source before publishing.

## Submissions

Community submissions arrive through the blog post issue template
(`.github/ISSUE_TEMPLATE/blog-post.yml`). The author dropdown there must stay in
sync with `blog/authors.yml`.

## Publishing cadence

Publish when there is material change to report; there is no fixed monthly
floor. Two posts and a year of silence is a worse signal than a cadence
statement the blog cannot keep, which is why the earlier "one post per month"
commitment was dropped (issue #1278) rather than restated.

The default recurring post is "Month in Metrics" — a short, data-driven recap
sourced from the current `data/metrics.json` (and, when relevant, new reference
architectures, award announcements, or event recaps). It is nearly free to
produce because it reuses data the site already generates instead of requiring
net-new reporting, so when there is something to report it should be the first
post considered.

To publish a Month in Metrics post:

1. Refresh data first: `npm run collect:metrics` (and
   `npm run validate:metrics`) so the post reflects the current
   `data/metrics.json`, not stale numbers.
2. Create `blog/YYYY-MM-DD-month-in-metrics-<month>-<year>.md` following the
   post format above, tagged `metrics`. Cite every figure with the same source
   links used on `/resources/metrics`; never restate a number without its
   `sourceUrl`.
3. Note what changed since the previous Month in Metrics post (new
   architectures, membership counts, award announcements) rather than repeating
   the same figures unchanged.
4. If there is no material change to report, do not publish filler. A gap in the
   archive is acceptable; a post that says nothing is not.
