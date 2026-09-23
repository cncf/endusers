---
name: frontend-ui-standards
description:
  Use when adding or changing Docusaurus components, global CSS, responsive
  layouts, accessibility, or theme-aware UI.
metadata:
  context7-sources:
    - /websites/docusaurus_io_3_9_2
unlisted: true
---

# Frontend UI Standards

## When to Use

Load this skill when changing React components, CSS modules, global styles,
landing-page layouts, navigation, footer UI, responsive behavior, or
accessibility.

## When NOT to Use

Do not use this as a content-authoring guide or as a substitute for validating
factual CNCF claims. Use the documentation-authoring skill for prose and verify
claims against authoritative CNCF sources.

## Core Process

1. Reuse the existing one-directory component pattern:
   `src/components/<Name>/index.js` and `styles.module.css`.
2. Keep reusable data in `data/` and import it with `@site/data/...`; use
   `useBaseUrl` for asset paths from data and `Link` for internal routes.
3. Put site-wide rules in `src/css/custom.css`; prefer theme variables over
   hard-coded colors.
4. Give interactive controls semantic elements, visible focus states, keyboard
   support, useful labels, empty states, and reduced-motion behavior.
5. Scope rules against Docusaurus stable classes when overriding theme content.
   Markdown links can be more specific than standalone component classes;
   selectors such as `.theme-doc-markdown .cta` may be required for CTA text
   color and decoration.
6. Use dedicated button background tokens instead of reusing light theme link
   colors. Validate normal-size button text at a minimum 4.5:1 contrast ratio in
   both light and dark themes.
7. Avoid spread of `Map`/`Set` iterators (`[...map.keys()]`); Babel loose mode
   can compile this into hydration-breaking code. Use `Array.from()`.
8. Self-host images under `static/img/`; never hotlink GitHub user attachments.
   Give images explicit `width` and `height` to avoid layout shift.

## Common Rationalizations

- **“The global link color will handle the CTA.”** Markdown link selectors can
  override component rules; inspect specificity and the generated CSS.
- **“The color looks fine in one theme.”** Check both theme variables and the
  actual foreground/background contrast.
- **“A screenshot is unnecessary for a small style change.”** Build output
  proves compilation, not readability; use a browser screenshot when browser
  tooling is available.
- **“More UI is automatically more useful.”** Prefer one reusable component and
  a small number of high-value surfaces over duplicated page-specific markup.

## Red Flags

- White text on a bright primary background.
- CTA labels whose computed color comes from a generic markdown/link selector.
- Colors that are only defined in one theme.
- Decorative controls implemented as non-interactive elements.
- Images without dimensions or data-driven assets that ignore
  `BASE_URL=/endusers/`.
- New components that duplicate existing data, modal, card, or filter logic.

## Verification

- Run `npm run build`; broken links must continue to fail the build.
- Run the relevant data/asset validation scripts.
- Run `npm run validate:button-contrast` after changing
  `--cncf-button-background*` tokens in `src/css/custom.css`.
- Inspect the generated CSS when selector specificity is involved.
- Verify light and dark themes, keyboard focus, mobile layout, and
  reduced-motion behavior with a browser screenshot when browser tooling is
  available.
- Confirm the repository remains clean after the change.

## Sources

- Docusaurus global CSS and stable theme class names:
  `/websites/docusaurus_io_3_9_2`
