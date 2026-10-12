// webpack loader that applies the data overlays in
// tests/e2e/fixtures/data/** to data/*.json.
//
// docusaurus.config.js installs this on the site's data directory only when
// E2E_COVERAGE=1, so the production build and the gating end-to-end job
// compile the checked-in data untouched. A data file with no committed
// overlay passes through byte-for-byte. Each additional pass of
// `npm run build:e2e:coverage` sets E2E_COVERAGE_BUILD=<name>, which layers
// tests/e2e/fixtures/data-<name>/** on top for that build only.
//
// See tests/tools/e2e-data-fixtures.cjs for the overlay format and for why
// the branches involved are unreachable without it.

'use strict';

const { overlaySource } = require('./e2e-data-fixtures.cjs');

module.exports = function e2eDataFixtureLoader(source) {
  const { source: patched, overlays } = overlaySource(
    this.resourcePath,
    source,
  );
  // Rebuild when an overlay changes, not only when the data file does.
  for (const overlay of overlays) this.addDependency(overlay);
  return patched;
};
