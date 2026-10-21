# Content security rules for imported architecture content

Reference-architecture pages and their diagrams are imported from a source this
repository does not control: the body of a GitHub issue anyone can open. The
importer runs unattended, and a published SVG or Markdown page executes in the
site's origin, so every import passes through validators that reject content
able to run script or fetch from third-party hosts. The same validators run in
CI over every committed page, including those that originated in
[cncf/architecture](https://github.com/cncf/architecture).

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

- The site's page policy (`img-src`, `script-src` and the rest) is built in
  `docusaurus.config.js` and delivered as a `<meta>` tag, which browsers do not
  apply to a file opened directly (for example a `.svg` URL). The parser-based
  gates above are therefore the primary control, and the CSP is defense in
  depth. On Netlify the `/*` `[[headers]]` block in `netlify.toml` sends the
  same policy as a response header, adding what a meta tag cannot carry --
  `frame-ancestors` (with `X-Frame-Options`) against clickjacking, a
  `default-src 'self'` fallback and `upgrade-insecure-requests` -- alongside
  `Permissions-Policy`, `X-Content-Type-Options: nosniff` and `Referrer-Policy`.
  `tests/netlify-publish-contract.test.mjs` fails if the header and the
  production meta policy disagree on any directive, and if any block that sends
  a CSP omits `default-src`, `object-src 'none'`, `base-uri`, `form-action` or
  `frame-ancestors`. For the directly-opened-asset case the meta tag can never
  reach, asset-scoped `[[headers]]` rules (`/img/*` and `/favicons/*`, the only
  paths that serve an SVG) add a flat denial, so a directly-opened SVG renders
  as an inert document even if a parser gate is bypassed. The denial leads with
  `default-src 'none'` on purpose: a fetch directive a header does not name is
  unrestricted rather than inherited, so `script-src 'none'; object-src 'none'`
  on their own stopped such an SVG from running script while leaving it free to
  fetch an image, stylesheet, font or `<iframe>` from any host — the same
  IP/User-Agent/`Referer` disclosure the remote-reference half of the SVG gate
  exists to prevent. `img-src 'self' data:`, `style-src 'self' 'unsafe-inline'`
  and `font-src 'self'` are the only allowances, and they name what the
  committed SVGs actually use. A flat denial carries no host list, so it cannot
  drift from the allowlists in `docusaurus.config.js`.
- Every control above travels inside an HTTPS response, so an attacker who keeps
  the visitor on cleartext never has to defeat one — the stripped response
  simply carries none of them.
  `Strict-Transport-Security: max-age=31536000; includeSubDomains`, sent by the
  same `[[headers]]` blocks, is the one control the browser remembers between
  responses: after the first HTTPS visit it refuses to speak `http://` to this
  host, so there is no cleartext request left to answer. Netlify sends no HSTS
  of its own, so `netlify.toml` is the whole control. `preload` is deliberately
  omitted: it is an effectively irreversible commitment over the apex domain and
  belongs to whoever administers `cncf.io`.
- A parser can still disagree with a browser on exotic input. The gates fail
  closed on anything the parser rejects, and both gates are allowlists: an
  element, attribute, node type or URL scheme is rejected unless it is listed
  below, so a construct nobody has thought of yet fails rather than passes.
  `tests/active-content-allowlist.test.mjs` generates arbitrary names and
  schemes and checks that nothing outside the lists survives either gate, and
  keeps the historical bypasses as named rows. Widening a list is a reviewed
  change to the module that owns it and to this page, which a contract test
  holds to the module.
- Inside an allowed `style` attribute or `<style>` block only URLs are checked;
  CSS properties themselves are not allowlisted.

## SVG rules (`active content: ...` findings)

`validate:architecture-assets` accepts a diagram only if everything in it is on
the allowlist below; anything else is a finding, whether or not it is known to
be dangerous. The lists are the SVG and HTML vocabulary the committed diagrams
and logos actually use, plus the closely related names editors emit for the same
drawings. Names are matched exactly, by namespace and case, so re-spelling a
construct or moving it under another prefix does not help -- remove it, or ask
for it to be reviewed and added.

- **SVG elements**: `a`, `circle`, `clipPath`, `defs`, `desc`, `ellipse`,
  `feBlend`, `feColorMatrix`, `feComposite`, `feDropShadow`, `feFlood`,
  `feGaussianBlur`, `feMerge`, `feMergeNode`, `feOffset`, `filter`,
  `foreignObject`, `g`, `image`, `line`, `linearGradient`, `marker`, `mask`,
  `metadata`, `path`, `pattern`, `polygon`, `polyline`, `radialGradient`,
  `rect`, `stop`, `style`, `svg`, `switch`, `symbol`, `text`, `textPath`,
  `title`, `tspan`, `use`.
- **SVG attributes**: `alignment-baseline`, `aria-describedby`, `aria-hidden`,
  `aria-label`, `aria-labelledby`, `baseline-shift`, `baseProfile`, `class`,
  `clip`, `clip-path`, `clip-rule`, `clipPathUnits`, `color`,
  `color-interpolation`, `color-interpolation-filters`, `color-rendering`, `cx`,
  `cy`, `d`, `direction`, `display`, `dominant-baseline`, `dx`, `dy`,
  `enable-background`, `fill`, `fill-opacity`, `fill-rule`, `filter`,
  `filterUnits`, `flood-color`, `flood-opacity`, `font-family`, `font-size`,
  `font-size-adjust`, `font-stretch`, `font-style`, `font-variant`,
  `font-weight`, `fr`, `fx`, `fy`, `gradientTransform`, `gradientUnits`,
  `height`, `href`, `id`, `image-rendering`, `in`, `in2`, `isolation`, `k1`,
  `k2`, `k3`, `k4`, `lang`, `lengthAdjust`, `letter-spacing`, `lighting-color`,
  `marker-end`, `marker-mid`, `marker-start`, `markerHeight`, `markerUnits`,
  `markerWidth`, `mask`, `maskContentUnits`, `maskUnits`, `mix-blend-mode`,
  `mode`, `offset`, `opacity`, `operator`, `orient`, `overflow`, `paint-order`,
  `pathLength`, `patternContentUnits`, `patternTransform`, `patternUnits`,
  `pointer-events`, `points`, `preserveAspectRatio`, `primitiveUnits`, `r`,
  `refX`, `refY`, `requiredExtensions`, `requiredFeatures`, `result`, `role`,
  `rotate`, `rx`, `ry`, `shape-rendering`, `spreadMethod`, `startOffset`,
  `stdDeviation`, `stop-color`, `stop-opacity`, `stroke`, `stroke-dasharray`,
  `stroke-dashoffset`, `stroke-linecap`, `stroke-linejoin`, `stroke-miterlimit`,
  `stroke-opacity`, `stroke-width`, `style`, `systemLanguage`, `target`,
  `text-anchor`, `text-decoration`, `text-rendering`, `textLength`, `transform`,
  `transform-origin`, `type`, `unicode-bidi`, `values`, `vector-effect`,
  `version`, `viewBox`, `visibility`, `width`, `word-spacing`, `writing-mode`,
  `x`, `x1`, `x2`, `y`, `y1`, `y2`, and any `data-*` attribute.
- **Root-only SVG attributes**: `content` (the draw.io diagram source, which
  `--fix` strips).
- **HTML elements inside `<foreignObject>`**: `a`, `b`, `br`, `code`, `div`,
  `em`, `font`, `hr`, `i`, `li`, `ol`, `p`, `pre`, `s`, `span`, `strike`,
  `strong`, `sub`, `sup`, `u`, `ul`, in the XHTML namespace.
- **HTML attributes**: `align`, `class`, `color`, `dir`, `face`, `href`, `id`,
  `lang`, `size`, `style`, `target`, `title`, and any `data-*` attribute.
- **Prefixed attributes**: `xlink:href`, `xlink:title`, `xml:lang`, `xml:space`.
- **Editor metadata namespaces**: `http://creativecommons.org/ns#`,
  `http://ns.adobe.com/AdobeIllustrator/10.0/`,
  `http://ns.adobe.com/Extensibility/1.0/`, `http://ns.adobe.com/Graphs/1.0/`,
  `http://ns.adobe.com/SaveForWeb/1.0/`, `http://purl.org/dc/elements/1.1/`,
  `http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd`,
  `http://www.inkscape.org/namespaces/inkscape`,
  `http://www.w3.org/1999/02/22-rdf-syntax-ns#`. Any element or prefixed
  attribute in one of these is allowed (browsers attach no behaviour to them),
  and its descendants are still checked.
- **Unprefixed attributes on editor metadata elements**: `bleed`, `bordercolor`,
  `borderopacity`, `bottomLeftOrigin`, `gridtolerance`, `guidetolerance`,
  `height`, `id`, `margin`, `objecttolerance`, `pagecolor`, `showgrid`, `units`,
  `width`, `x`, `y`.
- **URI schemes**: every `href` (plain or `xlink:`) and every CSS `url()`,
  `image-set()` or `@import` target, in any attribute or `<style>` block, must
  be relative, a `#fragment`, or use `http:`, `https:`, `mailto:`. `data:` is
  allowed only for raster images: `data:image/avif`, `data:image/bmp`,
  `data:image/gif`, `data:image/jpeg`, `data:image/png`, `data:image/webp`. A
  malformed `url()` token is rejected too, because the scanner cannot tell what
  it names.

A namespace may only be declared (`xmlns:...`) if it is one of the above, the
SVG namespace, XHTML, XLink or XML; an undeclared prefix makes the file not
well-formed. Notably absent, because each one runs script, loads content or
rewrites the document: `<script>`, `<animate>`, `<set>`, `<feImage>`,
`<iframe>`, `<object>`, `<embed>`, `<base>`, `<meta>`, form controls, every
`on*` handler, `src`, `srcset`, `srcdoc`, `action`, `formaction`, `cursor` and
`xml:base`.

The scanner also rejects, independently of the allowlist:

- **Processing instructions other than the XML declaration**: for example
  `<?xml-stylesheet ...?>`, which can fetch a remote stylesheet or apply an XSLT
  program to the image.
- **DOCTYPE declarations with entity declarations**: the XML parser expands
  author-defined entities before any scanner sees the document, so their
  payloads cannot be verified. SVG images have no reason to declare entities.
- **Non-UTF-8 files or encoding declarations**: a file the scanner cannot read
  faithfully (UTF-16, declared exotic encodings, NUL or replacement characters)
  is rejected rather than certified blind.

Findings read `contains a disallowed element <name>`,
`contains a disallowed attribute name on <element>` or
`contains a disallowed URI scheme in name on <element>: scheme:`. When the
importer mirrors an SVG it strips everything off the allowlist, rescans the
result, and fails the import if anything is left.

**`<foreignObject>` itself is allowed.** Editors such as draw.io emit it for
ordinary text labels, and imported diagrams rely on it. The HTML inside it must
declare the XHTML namespace and stay within the HTML lists above.

## SVG remote references (`remote reference: ...` findings)

A diagram must not make a visitor's browser fetch anything from another host.
The scanner flags, in any attribute or `<style>` block:

- `href` attributes (on anything but a `<a>` hyperlink) resolving to another
  host, including protocol-relative (`//host/...`) and backslash-obfuscated
  (`https:\\host\...`) spellings;
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

`validate:architectures` scans imported page bodies against three allowlists.
Anything not on them is rejected, including node kinds, elements and schemes
nobody has reviewed yet.

- **Markdown node types**: `blockquote`, `break`, `code`, `definition`,
  `delete`, `emphasis`, `footnoteDefinition`, `footnoteReference`, `heading`,
  `image`, `imageReference`, `inlineCode`, `link`, `linkReference`, `list`,
  `listItem`, `paragraph`, `root`, `strong`, `table`, `tableCell`, `tableRow`,
  `text`, `thematicBreak`: plain CommonMark/GFM prose, tables, images, links and
  code.
- **Inert inline HTML elements**: `b`, `br`, `code`, `em`, `hr`, `i`, `kbd`,
  `p`, `small`, `strong`, `sub`, `sup`, `u`, with no attributes.
- **Component**: the `CNCFProjectCard` component and its import line, which the
  importer itself emits, with the attributes `description`, `href`, `logo`,
  `name`, `since`, `version`, each a plain string.
- **URL schemes**: every link, image and definition destination, and the card
  `href` and `logo`, must be relative, a `#fragment`, or use `http:`, `https:`,
  `mailto:`.

Rejected: any other raw HTML/JSX element or attribute, any other import or
export, any braced `{expression}` (MDX evaluates it as JavaScript), and any
` ```mdx-code-block ` fence (Docusaurus compiles its body as MDX). Literal `{`
in prose must be escaped or reworded; the check fails closed. Findings read
`disallowed element <name>`, `disallowed attribute name on <element>`,
`disallowed node type name` or `disallowed URL scheme scheme:`.

The inline-element list above is matched exactly as written, in lower case. MDX
reads a lower-case tag name as an HTML element and any other casing as a
_component_ reference, so `<B>` is not the inert `<b>` the list allows — it
compiles to a lookup of a component named `B` that nothing defines, and the
build fails while rendering the page. Write these elements in lower case.

Image references in page bodies are rewritten during import: relative paths are
scoped to the architecture's own asset directory, an image whose scheme is not
on the list above is reduced to its alt text, and an image whose destination
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
