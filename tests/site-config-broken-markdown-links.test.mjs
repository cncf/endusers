// The broken-markdown-link policy of docusaurus.config.js, resolved through
// Docusaurus's own config validation rather than read off the file.
//
// `tests/site-config.test.mjs` pins `onBrokenLinks: 'throw'`, which is the
// *route* checker: it fires for a link whose resolved URL is not a page the
// site builds. Relative links between markdown files are a different
// checker with a separate setting, and nothing in the suite reads it.
// `tests/docs-contract.test.mjs` already states the dependency in prose --
// "relative links in docs/ must point at files that exist;
// onBrokenMarkdownLinks is 'warn', so the site build will not catch these" --
// and then asserts the rule itself, which is the right call. What is missing
// is the other half: nothing fails when the setting that comment describes
// changes underneath it. Setting it to 'ignore' is a one-token edit that
// removes the build's reporting of broken markdown links entirely while every
// check in the repository stays green.
//
// Resolution, not the literal, is what this file asserts, because Docusaurus
// 3 accepts the setting under two spellings and rewrites one into the other:
//
//   * `siteConfig.onBrokenMarkdownLinks` -- the spelling the config uses
//     today. @docusaurus/core/lib/server/configValidation.js logs
//     "deprecated and will be removed in Docusaurus v4" and copies the value
//     into the hook below.
//   * `siteConfig.markdown.hooks.onBrokenMarkdownLinks` -- the replacement.
//
// Reading the file would therefore pin a spelling rather than a policy, and
// would go quiet the moment the config migrated. Running the real config
// through the installed validator pins what the build actually does, and
// keeps doing so across the migration.
//
// The migration itself is separate work: `future: { v4: true }`
// is already set in docusaurus.config.js, so the repository has opted into v4
// compatibility while still declaring the option v4 removes. That edit is to
// production config rather than to a test, so it is not made here;
// DEPRECATED_ROOT_SPELLING below is the retiring baseline that records it,
// following the convention of KNOWN_UNBOUNDED_JOBS in
// tests/ci-supply-chain.test.mjs: the companion staleness test fails once the
// config migrates, so the entry has to be deleted in the same change rather
// than lingering as a false description of the file.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// docusaurus.config.js is ESM but calls require.resolve() for its plugin
// list, which Docusaurus supplies through its own loader. The same shim
// tests/site-config.test.mjs installs, for the same reason.
globalThis.require ??= createRequire(import.meta.url);

// Internal to @docusaurus/core, and deliberately so: the point is to resolve
// the config the way the build resolves it. A release that moves or renames
// this module fails here loudly, which is the signal that the resolution
// being pinned has changed.
const {
  validateConfig,
} = require('@docusaurus/core/lib/server/configValidation.js');

// Reporting levels, weakest first. 'ignore' silences the checker; the other
// two keep it reporting, which is what tests/docs-contract.test.mjs's rule is
// written against.
const SILENT = 'ignore';
const REPORTING_LEVELS = ['warn', 'throw'];

/**
 * Loads a fresh copy of the site config.
 *
 * Fresh rather than shared because validateConfig() mutates what it is given:
 * it clears the deprecated root spelling and writes the resolved value into
 * `markdown.hooks`. A shared object would leave later readers looking at a
 * config the repository does not contain.
 *
 * @returns {Promise<object>} the exported Docusaurus config
 */
async function loadConfig() {
  const suffix = `?load=${Math.random()}`;
  return (await import(`../docusaurus.config.js${suffix}`)).default;
}

/**
 * Resolves a config the way the Docusaurus build does.
 *
 * The validator logs the deprecation notice through console.warn; silenced
 * here so a green run of the suite is not indistinguishable from a run that
 * is reporting something.
 *
 * @param {object} config a Docusaurus site config
 * @returns {string} the effective broken-markdown-link level
 */
function effectiveLevel(config) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return validateConfig(config, 'docusaurus.config.js').markdown.hooks
      .onBrokenMarkdownLinks;
  } finally {
    console.warn = warn;
  }
}

/**
 * The spellings a config declares the setting under, as written.
 *
 * @param {object} config a Docusaurus site config, before validation
 * @returns {string[]} the declaring spellings, dotted
 */
function declaredSpellings(config) {
  const spellings = [];
  if (config.onBrokenMarkdownLinks !== undefined) {
    spellings.push('onBrokenMarkdownLinks');
  }
  if (config.markdown?.hooks?.onBrokenMarkdownLinks !== undefined) {
    spellings.push('markdown.hooks.onBrokenMarkdownLinks');
  }
  return spellings;
}

// Retiring baseline, not an allowance: docusaurus.config.js declares the
// setting under the root spelling Docusaurus 3 deprecates and Docusaurus 4
// removes, while `future: { v4: true }` is already set. Delete this constant
// and the two tests that read it in the same change that migrates the config
// to `markdown.hooks.onBrokenMarkdownLinks`; the staleness test below fails
// until that happens, so the entry cannot outlive the condition it records.
const DEPRECATED_ROOT_SPELLING = 'onBrokenMarkdownLinks';

test('the build reports broken markdown links rather than silencing them', async () => {
  const level = effectiveLevel(await loadConfig());
  assert.ok(
    REPORTING_LEVELS.includes(level),
    `docusaurus.config.js resolves broken markdown links to '${level}'; expected one of ${REPORTING_LEVELS.join(', ')}. '${SILENT}' stops the build reporting relative links between markdown files altogether, and onBrokenLinks does not cover them -- it checks resolved routes. tests/docs-contract.test.mjs asserts the docs/ half of that rule on the stated assumption that this setting still reports.`,
  );
});

test('the setting is declared under exactly one spelling', async () => {
  const spellings = declaredSpellings(await loadConfig());
  assert.deepEqual(
    spellings,
    [DEPRECATED_ROOT_SPELLING],
    `docusaurus.config.js should declare the broken-markdown-link level once; it declares it as ${spellings.length === 0 ? 'nothing' : spellings.join(' and ')}. Declaring both spellings is how a migration half-lands: the deprecated one silently wins, so the value a reader sees under markdown.hooks is not the value the build uses.`,
  );
});

test('the deprecated root spelling still reaches the build', async () => {
  // Non-vacuity for the baseline, and the fact that stops holding at v4: the
  // config's level is in force today only because the validator copies it
  // across. When the root option is removed the copy goes with it, and the
  // config falls back to the hook's own default rather than to the value
  // docusaurus.config.js states.
  const config = await loadConfig();
  const declared = config[DEPRECATED_ROOT_SPELLING];
  assert.ok(
    REPORTING_LEVELS.includes(declared),
    `docusaurus.config.js declares ${DEPRECATED_ROOT_SPELLING}: '${declared}'; update this test if the policy changed`,
  );
  assert.equal(effectiveLevel(config), declared);
});

test('the deprecated-spelling baseline retires itself', async () => {
  const config = await loadConfig();
  assert.notEqual(
    config[DEPRECATED_ROOT_SPELLING],
    undefined,
    `docusaurus.config.js no longer declares ${DEPRECATED_ROOT_SPELLING}, so DEPRECATED_ROOT_SPELLING in this file now describes a condition that does not exist. Delete it, along with this test and 'the deprecated root spelling still reaches the build', and assert markdown.hooks.onBrokenMarkdownLinks directly in 'the setting is declared under exactly one spelling'.`,
  );
});
