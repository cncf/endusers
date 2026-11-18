// Docusaurus plugin that publishes the instant the site was built as global
// data. A component that derives an elapsed time from a published timestamp
// (the median submission age on /resources/metrics) needs a clock the
// server-rendered HTML and the hydrating client agree on; reading Date.now()
// in render would print one value at build time and another in the browser,
// and React would report the hydration mismatch. The build instant is the
// same on both sides, so the derived value is deterministic and as fresh as
// the last deploy rather than as the last change to the data file.

/** The name the component passes to usePluginData(). */
export const PLUGIN_NAME = 'build-clock';

/**
 * @param {unknown} [_context] Docusaurus load context; unused.
 * @param {{ now?: () => Date }} [options] `now` is injectable for tests.
 */
export default function buildClockPlugin(
  _context,
  { now = () => new Date() } = {},
) {
  return {
    name: PLUGIN_NAME,
    contentLoaded({ actions }) {
      actions.setGlobalData({ builtAt: now().toISOString() });
    },
  };
}
