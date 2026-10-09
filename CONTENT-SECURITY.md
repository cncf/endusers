# Content security rules for imported architecture content

Reference-architecture pages and their diagrams are imported from sources this
repository does not control: a
[cncf/architecture](https://github.com/cncf/architecture) checkout, or the body
of a GitHub issue anyone can open. Both importers run unattended, and a
published SVG or Markdown page executes in the site's origin, so every import
passes through validators that reject content able to run script or fetch from
third-party hosts.

Those validators are `npm run validate:architectures` (page bodies) and
`npm run validate:architecture-assets` (SVG diagram files). When a submission
fails the automated import, the workflow run's log names the finding using the
vocabulary below. This page explains what each rule means, why it exists, and
how to fix a rejected submission.

## Why these rules exist

- **SVG is a document format, not just an image format.** A browser that opens a
  diagram directly (for example `/img/architectures/example/diagram.svg`)
  executes any script it contains with the site's origin.
- **Docusaurus compiles `.md` pages as MDX**, so raw HTML, JSX, or a braced
  `{expression}` in an imported body is rendered or evaluated rather than
  escaped — build-time code execution from an issue body.
- **A published image is fetched by every visitor's browser.** An `<img>` or CSS
  `url()` pointing at a third-party host sends each visitor's IP address,
  User-Agent, and Referer to a host the submitter chose. All imported artwork is
  mirrored locally for exactly this reason.

## How the scanners work

The scanners read a parse tree; they do not pattern-match text. SVG is parsed
with [`sax`](https://github.com/isaacs/sax-js) as strict XML, CSS inside SVG is
tokenized with the [`css-tree`](https://github.com/csstree/csstree) tokenizer
(so escapes, comments, and quote pairing are resolved the way a browser resolves
them), and Markdown/MDX is parsed with the same micromark grammar Docusaurus
compiles pages with. Shared URI rules live in `scripts/lib/uri-safety.mjs`.

Two consequences matter when a submission is rejected:

- **A document the parser rejects is itself a finding.** An unquoted attribute,
  an unclosed tag, an undefined entity such as `&nbsp;`, or an unterminated
  DOCTYPE is reported as `is not well-formed XML`. A scanner that cannot read a
  file cannot vouch for it, and a browser may read it differently. Fix the
  markup rather than working around the message.
- **Stripping rebuilds the document from the parse** instead of deleting
  character ranges, so removing one element cannot join the text around it into
  a new one.

### Residual risks and compensating controls

- The site's Content-Security-Policy is delivered as a `<meta>` tag, which
  browsers do not apply to a file opened directly (for example a `.svg` URL).
  The parser-based gates above are therefore the primary control, and the CSP is
  defense in depth.
- A parser can still disagree with a browser on exotic input. The gates fail
  closed on anything the parser rejects, and every historical bypass is kept as
  a regression fixture in `tests/svg-active-content.test.mjs` and
  `tests/mdx-active-content.test.mjs`. A new bypass belongs in those fixtures
  and, if it needs a new rule, in the parser walk, not in a new regular
  expression.

## SVG rules (`active content: ...` findings)

`validate:architecture-assets` rejects a diagram that contains any of the
following. The scanner tolerates namespace prefixes, entity-encoded scheme
characters, and whitespace obfuscation, so re-spelling a construct does not help
— remove it.

- **Script-bearing or embedding elements**: `<script>`, `<handler>`,
  `<listener>`, `<iframe>`, `<embed>`, `<object>`.
- **Event-handler attributes**: any `on*` attribute (`onload`, `onclick`, ...).
- **Script-executing URI schemes** in any attribute: `javascript:`, `vbscript:`,
  `livescript:`, `mocha:`, and `data:` URIs carrying a markup or script media
  type (`text/html`, `text/xml`, `application/xml`, `text/xsl`, any `+xml` type
  such as `image/svg+xml`, and JavaScript types).
- **Embedded-document attributes**: `srcdoc`.
- **`<animate>`/`<set>` targeting `href`**: an animation can install a script
  URI at runtime on an element that looks inert in the source.
- **Processing instructions other than the XML declaration**: for example
  `<?xml-stylesheet ...?>`, which can fetch a remote stylesheet or apply an XSLT
  program to the image.
- **DOCTYPE declarations with entity declarations**: the XML parser expands
  author-defined entities before any scanner sees the document, so their
  payloads cannot be verified. SVG images have no reason to declare entities.
- **Non-UTF-8 files or encoding declarations**: a file the scanner cannot read
  faithfully (UTF-16, declared exotic encodings, NUL or replacement characters)
  is rejected rather than certified blind.

**`<foreignObject>` itself is allowed.** Editors such as draw.io emit it for
ordinary text labels, and imported diagrams rely on it. Only the embedding
elements listed above are banned inside it.

## SVG remote references (`remote reference: ...` findings)

A diagram must not make a visitor's browser fetch anything from another host.
The scanner flags, in any attribute or `<style>` block:

- `href`/`src` attributes resolving to another host, including protocol-relative
  (`//host/...`) and backslash-obfuscated (`https:\\host\...`) spellings;
- CSS `url(...)`, bare-string `@import`, and `image-set()` targets, including
  forms hidden behind CSS escapes or comments — presentation attributes such as
  `fill="url(https://...)"` count the same as `style`.

Local references (`#gradient`, `images/foo.png`, `/img/...`) are fine.

### Exporting a compliant diagram

- From draw.io/diagrams.net: File > Export as > SVG, uncheck "Include a copy of
  my diagram" (the embedded `mxfile` is removed by the importer anyway) and
  avoid linking images by URL — embed or attach them instead.
- Fonts: let text fall back to system fonts rather than `@import`-ing a webfont.
- If a run reports findings you cannot locate, run the validator locally (see
  below); it prints one line per finding with the offending value.

## Markdown/MDX page rules (`active content in imported page`)

`validate:architectures` scans imported page bodies. Allowed:

- Plain CommonMark/GFM prose, tables, images, and links.
- A small set of inert inline HTML elements: `b`, `br`, `code`, `em`, `hr`, `i`,
  `kbd`, `p`, `small`, `strong`, `sub`, `sup`, `u`.
- The `CNCFProjectCard` component and its import line, which the importer itself
  emits.

Rejected: any other raw HTML/JSX element, and any braced `{expression}` (MDX
evaluates it as JavaScript). Literal `{` in prose must be escaped or reworded;
the check fails closed.

Image references in page bodies are rewritten during import: relative paths are
scoped to the architecture's own asset directory, and an image whose destination
names any host — including protocol-relative `//host/...` — is demoted to a
plain link unless it is a cncf/artwork URL the importer can mirror. Images are
found in the parse tree, so reference-style images (`![alt][ref]`) follow the
same rules as inline ones.

## Project-card logo policy

Logos in the projects table must be `https://` URLs into
[cncf/artwork](https://github.com/cncf/artwork) on its default branch, in one of
these forms:

- `https://raw.githubusercontent.com/cncf/artwork/main/<path>.svg`
- `https://github.com/cncf/artwork/raw/main/<path>.svg`

Commit-SHA refs are rejected (on raw.githubusercontent.com a SHA from a fork's
pull request serves bytes that were never in cncf/artwork), `http://` is
rejected, and other hosts are rejected. The referenced images are mirrored and
sanitized into the site rather than hot-linked.

## Running the validators locally

Before re-applying the `architecture-ready` label to a failed submission, you
can reproduce the gate locally:

```sh
npm ci
npm run validate:architectures
npm run validate:architecture-assets
```

Both commands print one line per finding. The automated import applies the same
checks, so a locally green submission will pass the workflow's validation step.
