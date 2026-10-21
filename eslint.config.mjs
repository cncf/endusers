// ESLint flat config for the site's JavaScript: src/, scripts/, tests/ and the
// root config files. Run with `npm run check:lint`.
import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// A module URL's `pathname` stays percent-encoded and keeps the leading `/`
// before a Windows drive letter, so it is not a filesystem path. Only URLs
// built from `import.meta.url` are flagged; `.pathname` on a web URL is fine.
const NO_IMPORT_META_PATHNAME = {
  selector:
    "MemberExpression[property.name='pathname'][object.type='NewExpression'][object.callee.name='URL']:has(MetaProperty)",
  message:
    'Derive filesystem paths with fileURLToPath(new URL(..., import.meta.url)) from node:url, not URL.pathname.',
};

// An href that is a string literal stays on this origin only when it is a
// site-relative path or a fragment; an expression href stays on it only when
// it visibly starts with `#`. Anything else may leave the origin.
const SAME_ORIGIN_HREF =
  "JSXAttribute[name.name='href']:matches([value.type='Literal'][value.value=/^(?![a-z][a-z0-9+.-]*:|\\/\\/)/i], [value.expression.type='Literal'][value.expression.value=/^#/], [value.expression.type='TemplateLiteral'][value.expression.quasis.0.value.raw=/^#/])";

const JSX_LINK_HYGIENE = [
  {
    selector: `JSXOpeningElement[name.name='a']:not(:has(${SAME_ORIGIN_HREF})):not(:has(JSXAttribute[name.name='rel'][value.value=/(^|\\s)noreferrer(\\s|$)/]))`,
    message:
      'An <a> that can leave this origin needs a literal rel="noreferrer" so no Referer naming this site is sent to the third-party host.',
  },
  {
    selector:
      'JSXAttribute[name.name=/^(href|src)$/][value.value=/^http:\\/\\//i]',
    message:
      'Plain-http href/src is blocked as mixed content on an https site; use https.',
  },
];

export default [
  {
    ignores: [
      'build/',
      '.docusaurus/',
      'coverage/',
      'test-results/',
      'playwright-report/',
      'blob-report/',
    ],
  },
  js.configs.recommended,
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'no-restricted-syntax': ['error', NO_IMPORT_META_PATHNAME],
      // `_`-prefixed bindings are deliberately unused placeholders.
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },
  {
    files: ['*.{js,mjs}', 'scripts/**', 'tests/**'],
    languageOptions: { globals: globals.node },
  },
  {
    // Playwright specs run in Node, but page.evaluate() callbacks run in the
    // browser page.
    files: ['tests/e2e/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['src/**'],
    ...react.configs.flat.recommended,
    ...react.configs.flat['jsx-runtime'],
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      globals: globals.browser,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.flat.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // Components take data-shaped props from JSON; no PropTypes are declared.
      'react/prop-types': 'off',
      'react/no-unknown-property': 'error',
      'react/jsx-no-target-blank': 'error',
      'no-restricted-syntax': [
        'error',
        NO_IMPORT_META_PATHNAME,
        ...JSX_LINK_HYGIENE,
      ],
    },
  },
];
