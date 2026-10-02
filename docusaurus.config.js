// @ts-check
// `@type` JSDoc annotations allow editor autocompletion and type checking
// (when paired with `@ts-check`).
// There are various equivalent ways to declare your Docusaurus config.
// See: https://docusaurus.io/docs/api/docusaurus-config

import { themes as prismThemes } from 'prism-react-renderer';

const siteUrl = process.env.SITE_URL || 'https://endusers.cncf.io';
const baseUrl = process.env.BASE_URL || '/';

// Remote hosts the browser may load an image from. This mirrors
// isAllowedImageHost() in scripts/lib/profile-image.mjs, which gates the
// profile images copied unattended out of cncf/people into
// data/community-people.json; tests/site-config.test.mjs fails if the two ever
// disagree, in either direction.
//
// The gate decides what gets committed; this decides what the browser will
// actually fetch, and it is what holds when an image reference reaches a page
// without passing a gate — a component added without one, a data file added
// without a validator, or a regression in an existing check. Without img-src,
// any such value is a live third-party beacon that receives every visitor's
// IP, User-Agent and Referer on page load.
const IMAGE_HOST_SOURCES = [
  'https://raw.githubusercontent.com',
  'https://avatars.githubusercontent.com',
  'https://github.com',
  'https://www.github.com',
  'https://cncf.io',
  'https://*.cncf.io',
];

function endusersE2ESourceMaps() {
  return {
    name: 'endusers-e2e-source-maps',
    configureWebpack(config, isServer) {
      if (isServer) return {};
      return { devtool: 'source-map' };
    },
  };
}

// Applies the committed data overlays in tests/e2e/fixtures/data/** to the
// site's data/*.json imports. Some component branches render only for data
// shapes the checked-in files never take (an archived user group, an awards
// file with no verification date), so no browser test can reach them against
// production data. Overlaying only in the coverage build keeps
// `npm run build:production`, the gating end-to-end job and the deployed site
// on the real data. See tests/tools/e2e-data-fixtures.cjs.
function endusersE2EDataFixtures() {
  return {
    name: 'endusers-e2e-data-fixtures',
    configureWebpack(config) {
      // Both paths are derived from the site directory the bundler was handed
      // rather than from this file's own location: Docusaurus evaluates this
      // config through its own loader, so a relative require here resolves
      // against whatever module did the evaluating.
      const { join } = require('path');
      const siteDir = config.resolve.alias['@site'];
      return {
        module: {
          rules: [
            {
              test: /\.json$/,
              include: join(siteDir, 'data'),
              type: 'json',
              use: [join(siteDir, 'tests/tools/e2e-data-fixture-loader.cjs')],
            },
          ],
        },
      };
    },
  };
}

const E2E_COVERAGE = process.env.E2E_COVERAGE === '1';
const E2E_SOURCE_MAP_PLUGIN = E2E_COVERAGE ? endusersE2ESourceMaps : null;
const E2E_DATA_FIXTURE_PLUGIN = E2E_COVERAGE ? endusersE2EDataFixtures : null;

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'CNCF End User Community',
  tagline: 'The community for Cloud Native End Users',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here.
  // Override with SITE_URL/BASE_URL for non-production deployments such as
  // GitHub Pages previews (e.g. SITE_URL=https://cncf.github.io BASE_URL=/endusers/).
  url: siteUrl,
  baseUrl,

  // Preserve broken-link enforcement; do not weaken.
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  // Structured data for the site identity. Page-level schema should be added
  // only when it can be maintained from verified data sources.
  headTags: [
    {
      tagName: 'link',
      attributes: {
        rel: 'manifest',
        href: `${baseUrl}manifest.json`,
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: `${baseUrl}favicons/apple-touch-icon.png`,
      },
    },
    {
      tagName: 'meta',
      attributes: {
        'http-equiv': 'Content-Security-Policy',
        // Defence in depth for content this site does not author: architecture
        // MDX and image assets are mirrored from cncf/architecture, and several
        // data/*.json files supply href and src values rendered by src/components.
        // These directives need no allowance for inline or bundled script, so
        // they hold without constraining Docusaurus hydration or local search.
        // script-src is deliberately omitted: Docusaurus emits inline bootstrap
        // scripts, so it could only ship with 'unsafe-inline', which would add no
        // protection. frame-ancestors is omitted because browsers ignore it when
        // delivered via <meta http-equiv>; it needs a real response header.
        // img-src, by contrast, is honoured in a meta policy, and it is the
        // directive that actually backs this project's remote-image host gates
        // (scripts/lib/profile-image.mjs, scripts/lib/project-assets.mjs, the
        // SVG remote-reference check in scripts/lib/svg-active-content.mjs).
        // `data:` is required: Infima inlines small SVG icons as data URIs.
        //
        // There is no `default-src` here, so every fetch directive that is not
        // named below is unrestricted rather than inheriting a fallback. That
        // left `<iframe>`, media elements and outbound `fetch()` open to any
        // host while `<object>`/`<embed>` were closed by `object-src 'none'` —
        // an asymmetry, since an iframe is the more capable of the two. The
        // three directives below close it, on the same defence-in-depth
        // footing as `img-src`: the element allowlist in
        // scripts/lib/mdx-active-content.mjs already refuses `<iframe>`,
        // `<video>` and `<audio>` in imported bodies, and these hold if that
        // gate is bypassed, regressed, or skipped by a page added without one.
        // Each is set to what the site actually uses: it ships no frame, no
        // media element and no client-side request to a third-party origin
        // (the local search plugin reads its index from this origin), so
        // nothing here constrains Docusaurus hydration or local search.
        // `style-src`/`font-src` are still omitted: Docusaurus emits inline
        // styles, so they could only ship with 'unsafe-inline' and would add
        // no protection, exactly as with script-src.
        content: [
          "base-uri 'self'",
          "object-src 'none'",
          "frame-src 'none'",
          "media-src 'none'",
          "connect-src 'self'",
          "form-action 'self'",
          `img-src 'self' data: ${IMAGE_HOST_SOURCES.join(' ')}`,
        ].join('; '),
      },
    },
    {
      tagName: 'script',
      attributes: {
        type: 'application/ld+json',
      },
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'CNCF End User Community',
        url: siteUrl,
        logo: `${siteUrl.replace(/\/$/, '')}${baseUrl === '/' ? '' : baseUrl.replace(/\/$/, '')}/img/cloud-native-end-users.svg`,
        parentOrganization: {
          '@type': 'Organization',
          name: 'Cloud Native Computing Foundation',
          url: 'https://www.cncf.io/',
        },
        sameAs: ['https://www.cncf.io/', 'https://github.com/cncf/tab'],
      }),
    },
  ],

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
    path: 'i18n',
    localeConfigs: {
      en: {
        label: 'English',
        direction: 'ltr',
        htmlLang: 'en-US',
        calendar: 'gregory',
        path: 'en',
      },
    },
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          routeBasePath: '/', // Serve the docs at the site's root
          sidebarPath: './sidebars.js',
          editUrl: 'https://github.com/cncf/endusers/tree/main',
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          editUrl: 'https://github.com/cncf/endusers/tree/main/',
          // Useful options to enforce blogging best practices
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
        sitemap: {
          // /search is thin duplicate content; the plugin's own opt-out is
          // emitted as property="robots", which neither Docusaurus nor a
          // crawler honours. /skills/* is agent tooling, not site content.
          ignorePatterns: ['/search', '/skills/**'],
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/social-card.png',
      // Site-wide SEO metadata applied to every page unless overridden.
      metadata: [
        {
          name: 'description',
          content:
            'The CNCF End User Community connects practitioners, architects, and organizations running cloud native technologies in production.',
        },
        {
          name: 'keywords',
          content:
            'CNCF, end user, cloud native, Kubernetes, practitioners, reference architectures, community',
        },
        { name: 'author', content: 'Cloud Native Computing Foundation' },
      ],
      // Respect the visitor's system-level motion and color preferences.
      colorMode: {
        defaultMode: 'light',
        respectPrefersColorScheme: true,
      },
      docs: {
        sidebar: {
          hideable: true,
        },
      },
      tableOfContents: {
        minHeadingLevel: 2,
        maxHeadingLevel: 4,
      },
      navbar: {
        title: '',
        hideOnScroll: false,
        logo: {
          alt: 'Cloud Native End Users',
          src: 'img/cloud-native-end-users.svg',
          srcDark: 'img/cloud-native-end-users-dark.svg',
        },
        items: [
          // Left
          {
            to: '/',
            label: 'Practitioners',
            position: 'left',
            activeBaseRegex: '^/$',
          },
          {
            type: 'docSidebar',
            sidebarId: 'architecturesSidebar',
            position: 'left',
            label: 'Architectures',
          },
          {
            type: 'docSidebar',
            sidebarId: 'communitySidebar',
            position: 'left',
            label: 'Community',
          },
          {
            to: '/community#projects-born-at-end-user-organizations',
            label: 'Projects from end users',
            position: 'left',
          },

          // Right
          {
            type: 'docSidebar',
            sidebarId: 'resourcesSidebar',
            position: 'right',
            label: 'Resources',
          },
          {
            to: '/metrics/',
            label: 'Metrics',
            position: 'right',
          },
          {
            to: '/events/',
            label: 'Events',
            position: 'right',
          },
          { to: '/blog', label: 'Blog', position: 'right' },
        ],
      },
      footer: {
        // The rendered footer is the swizzled component in src/theme/Footer.
        style: 'dark',
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
  plugins: [
    E2E_SOURCE_MAP_PLUGIN,
    E2E_DATA_FIXTURE_PLUGIN,
    [
      require.resolve('docusaurus-plugin-search-local'),
      /** @type {import('docusaurus-plugin-search-local').PluginOptions} */
      ({
        // Docs are served at the site root (see docs.routeBasePath above),
        // but the plugin defaults docsRouteBasePath to ["docs"], which
        // matches no route on this site -- every docs page silently went
        // unindexed and search returned blog posts only (#769).
        docsRouteBasePath: '/',
      }),
    ],
  ].filter(Boolean),
};

export default config;
