// knip finds unused files, exports and dependencies. Run with
// `npm run check:unused`. Plugins for Docusaurus, Playwright, node --test,
// GitHub Actions and the package.json scripts are enabled automatically; the
// entries below cover what they do not see.

// Docusaurus compiles docs/ and blog/ `.md` as MDX, so their import lines are
// what pull components out of src/. Fenced code blocks are dropped first so an
// import shown as an example is not mistaken for a real one.
function mdImports(text) {
  const source = text.replace(/^```[\s\S]*?^```/gm, '');
  return [...source.matchAll(/^import[^'"]+['"][^'"]+['"]/gm)]
    .map(([statement]) => statement)
    .join('\n');
}

/** @type {import('knip').KnipConfig} */
const config = {
  entry: [
    'docs/**/*.{md,mdx}',
    'blog/**/*.{md,mdx}',
    'src/theme/**/*.{js,jsx}',
    // Docs instance docusaurus.config.js adds when E2E_COVERAGE=1.
    'tests/e2e/fixtures/docs/*.mdx',
  ],
  // Root and .github Markdown is prose, not site content, so it is left out.
  project: [
    '**/*.{js,mjs,cjs,jsx}',
    '{docs,blog}/**/*.{md,mdx}',
    'tests/e2e/fixtures/docs/*.mdx',
  ],
  compilers: { md: mdImports },
  ignoreDependencies: [
    // Platform binding of @swc/core, pinned on purpose; see
    // tests/swc-native-binding-contract.test.mjs.
    '@swc/core-linux-x64-gnu',
    // Spawned from node_modules/.bin by scripts/check-duplication.mjs.
    'jscpd',
    // Run through `npx` inside xargs pipelines in package.json scripts.
    'markdown-link-check',
    'markdownlint-cli',
    // Type-only JSDoc import in docusaurus.config.js and sidebars.js; installed
    // by @docusaurus/preset-classic.
    '@docusaurus/plugin-content-docs',
  ],
  ignoreIssues: {
    // Tests load it through importSource(), a dynamic import knip cannot follow.
    'src/components/MemberDirectory/hooks.js': ['exports'],
  },
  // Coreutils, used by tests to create named pipes.
  ignoreBinaries: ['mkfifo'],
};

export default config;
