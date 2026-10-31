// Docusaurus plugin that publishes the event catalog as global data so the
// EventsIndex component can render it. The list comes from
// ./events-catalog.mjs, the one reader of event front matter that sidebars.js
// also builds from, so the index and the sidebar agree (ADR 0012). It lives
// under scripts/lib/ rather than src/ because it runs in Node at config load
// and never ships to the browser, which the end-to-end coverage lane requires
// of everything under src/.

import { join } from 'node:path';
import { collectEvents, groupByYear } from './events-catalog.mjs';

/** The name the component passes to usePluginData(). */
export const PLUGIN_NAME = 'events-catalog';

/**
 * Docusaurus passes its load context; knip's docusaurus plugin invokes inline
 * plugin functions with no arguments to discover their inputs, so the site
 * directory falls back to the working directory Docusaurus itself defaults to.
 *
 * @param {{ siteDir?: string }} [context]
 */
export default function eventsCatalogPlugin(context = {}) {
  const docsDir = join(context.siteDir ?? process.cwd(), 'docs');
  return {
    name: PLUGIN_NAME,
    loadContent() {
      return collectEvents(docsDir);
    },
    contentLoaded({ content, actions }) {
      actions.setGlobalData({ years: groupByYear(content) });
    },
    // The dev server reloads the index when an event page is added or edited.
    getPathsToWatch() {
      return [join(docsDir, 'events', '**', '*.{md,mdx}')];
    },
  };
}
