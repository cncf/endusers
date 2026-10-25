// @ts-check
// `@type` JSDoc annotations allow editor autocompletion and type checking
// (when paired with `@ts-check`).
// There are various equivalent ways to declare your Docusaurus config.
// See: https://docusaurus.io/docs/api/docusaurus-config

import { themes as prismThemes } from 'prism-react-renderer';

const siteUrl = process.env.SITE_URL || 'https://endusers.cncf.io';
const baseUrl = process.env.BASE_URL || '/';

// Script sources the browser may execute.
//
// `'unsafe-inline'` is unavoidable: Docusaurus emits inline bootstrap scripts
// on every page. It is not a reason to omit the directive, though — omitting
// it leaves *no* restriction at all, so any host may serve a `<script src>`,
// while `'self' 'unsafe-inline'` still refuses every off-origin script. That
// is the same asymmetry `frame-src`/`media-src`/`connect-src` were added to
// close. The production bundles reference only same-origin scripts, so
// `'self'` costs nothing.
//
// `'unsafe-eval'` is added outside production only: the dev server builds with
// webpack's `eval-cheap-module-source-map` devtool (see
// @docusaurus/core/lib/webpack/base.js), which wraps every module in `eval()`.
// The production bundles contain no `eval` at all, so the deployed policy does
// not carry it.
const SCRIPT_SOURCES = [
  "'self'",
  "'unsafe-inline'",
  ...(process.env.NODE_ENV === 'production' ? [] : ["'unsafe-eval'"]),
];

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
    async postBuild({ outDir }) {
      const { writeFile } = require('node:fs/promises');
      const { join } = require('node:path');
      await writeFile(
        join(outDir, 'e2e-coverage-runtime.json'),
        JSON.stringify({ node: process.version, v8: process.versions.v8 }),
      );
    },
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

// Writes robots.txt into the build from the resolved site URL, so the
// `Sitemap:` line (which must be absolute) follows `url`/`baseUrl` instead of
// being a committed string. The static copy it replaces advertised the
// retired GitHub Pages origin for the whole life of the Netlify site, and
// nothing could have caught that: on Netlify the origin is a deploy-time
// value (scripts/netlify-build.mjs), and it changes again at the
// endusers.cncf.io cutover (#1433). Writing it in postBuild means that
// cutover is a build, not a repository change.
function endusersRobotsTxt() {
  return {
    name: 'endusers-robots-txt',
    async postBuild({ siteConfig, outDir }) {
      const { writeFileSync } = require('fs');
      const { join } = require('path');
      const sitemapUrl = new URL(
        `${siteConfig.baseUrl}sitemap.xml`,
        siteConfig.url,
      ).href;
      writeFileSync(
        join(outDir, 'robots.txt'),
        `User-agent: *\nAllow: /\n\nSitemap: ${sitemapUrl}\n`,
      );
    },
  };
}

// Syntax-highlighting colours that fall short of the 4.5:1 WCAG AA contrast
// ratio on their theme's own code-block background, mapped to the same hue
// darkened (github, on #f6f8fa) or lightened (dracula, on #282a36) until it
// clears 4.6:1. prism-react-renderer's github theme fails on five token
// groups -- comments, strings, numbers/properties, keywords and tags -- so
// every YAML block in /architectures/* reported axe color-contrast; dracula
// only fails on comments.
const AA_TOKEN_COLORS = {
  '#999988': '#717165',
  '#e3116c': '#da1068',
  '#36acaa': '#277c7a',
  '#00a4db': '#0079a2',
  '#d73a49': '#ce3846',
  'rgb(98, 114, 164)': '#8692b9',
};

function withAAContrast(theme) {
  return {
    ...theme,
    styles: theme.styles.map((entry) => {
      const color = AA_TOKEN_COLORS[String(entry.style.color).toLowerCase()];
      return color ? { ...entry, style: { ...entry.style, color } } : entry;
    }),
  };
}

const E2E_COVERAGE = process.env.E2E_COVERAGE === '1';
const E2E_SOURCE_MAP_PLUGIN = E2E_COVERAGE ? endusersE2ESourceMaps : null;
const E2E_DATA_FIXTURE_PLUGIN = E2E_COVERAGE ? endusersE2EDataFixtures : null;

// The data overlays above reach components that read data/*.json. They cannot
// reach a component whose props come from generated MDX: the architecture
// pages under docs/architectures/ are committed files (generated by the
// submission importer or kept from the original catalog), not documents
// assembled at build time, so a prop shape absent from every one of them is
// absent from every build.
//
// This second docs instance serves tests/e2e/fixtures/docs/** under its own
// route so such a shape can exist without touching published content. Like the
// data overlays it is registered only when E2E_COVERAGE=1, so
// `npm run build:production`, the gating "End-to-end tests" job and the
// deployed site never compile or link these pages.
const E2E_FIXTURE_DOCS_ROUTE = 'e2e-coverage-fixtures';
const E2E_FIXTURE_DOCS_PLUGIN = E2E_COVERAGE
  ? [
      require.resolve('@docusaurus/plugin-content-docs'),
      {
        id: 'e2e-coverage-fixtures',
        path: 'tests/e2e/fixtures/docs',
        routeBasePath: E2E_FIXTURE_DOCS_ROUTE,
        sidebarPath: false,
      },
    ]
  : null;

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
  // subpath previews (e.g. SITE_URL=https://example.github.io BASE_URL=/endusers/).
  // On Netlify, scripts/netlify-build.mjs derives SITE_URL from the deploy context.
  url: siteUrl,
  baseUrl,
  // Netlify serves every page under its trailing-slash URL and 301s the bare
  // form. Generate the same shape, so the canonical URL and sitemap name the
  // document that answers 200 rather than a redirect to it.
  trailingSlash: true,

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
        name: 'referrer',
        // Without this the browser applies its default,
        // strict-origin-when-cross-origin, which still attaches a cross-origin
        // `Referer` naming this site's origin to every off-origin request.
        //
        // The requests that matter here are subresources, not navigations:
        // data/community-people.json supplies image URLs on
        // raw.githubusercontent.com and avatars.githubusercontent.com that
        // src/components/CommunityPeople renders as plain `<img src>`, so they
        // fire on page load with no user action. `rel="noreferrer"` is an
        // anchor-only control and cannot reach them; a document policy is the
        // mechanism this site uses. netlify.toml also sends the same value as
        // a Referrer-Policy response header, which is what covers a .svg or
        // .json opened directly; the meta tag is kept so the policy travels
        // with the HTML and holds on any static host.
        //
        // This is the disclosure half of the same exposure `img-src` below
        // addresses. `img-src` decides which hosts may be contacted at all;
        // it says nothing about what is revealed to the hosts it admits.
        //
        // `same-origin` rather than `no-referrer`: every off-origin request
        // the built site makes is an image on a host named in
        // IMAGE_HOST_SOURCES, none of which need a referrer, while
        // same-origin navigation and the local search plugin keep the full
        // referrer they have today. Unlike `frame-ancestors`, which browsers
        // ignore in a meta tag, `name="referrer"` is an HTML metadata name
        // rather than a CSP directive and is honoured when delivered this way.
        content: 'same-origin',
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
        // script-src and style-src ship with 'unsafe-inline' because
        // Docusaurus emits inline bootstrap scripts and inline styles. That
        // does not make them pointless: without the directive, and with no
        // default-src to fall back to, the browser applies *no* restriction,
        // so any host may serve a `<script src>` or a `<link rel=stylesheet>`
        // on this origin. 'self' 'unsafe-inline' still refuses every
        // off-origin script and stylesheet while permitting the inline code
        // the framework needs -- the same asymmetry frame-src, media-src and
        // connect-src were added to close. The built site references only
        // same-origin bundles and one same-origin stylesheet, so neither
        // directive constrains Docusaurus hydration or local search. See
        // SCRIPT_SOURCES above for why 'unsafe-eval' is dev-only.
        // frame-ancestors is omitted here because browsers ignore it when
        // delivered via <meta http-equiv>. On Netlify the HTML catch-all in
        // netlify.toml sends the complete policy as a response header: every
        // directive below restated verbatim, plus frame-ancestors, default-src
        // and upgrade-insecure-requests. tests/netlify-publish-contract.test.mjs
        // fails if the header and this production policy disagree on any
        // directive, so a change here has to be made there too. This tag stays
        // for the dev server and any host that does not read netlify.toml.
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
        // `font-src` joins them on the same footing. It was the last fetch
        // directive still unnamed, so the browser would load a font from any
        // host -- and `style-src` carries 'unsafe-inline', so an inline
        // `@font-face` that reached a page could name one, beaconing the
        // visitor's IP, User-Agent and Referer to it. It was left out only
        // because nothing in the build asserted the premise; the CSS scan in
        // tests/site-config.test.mjs now does, so the directive can be set.
        // The site's fonts are vendored in static/fonts and referenced by
        // root-relative url(), so 'self' constrains nothing it actually does.
        //
        // `manifest-src` is the last fetch directive with no fallback of its
        // own. CSP3 6.8.2 gives its chain as << "manifest-src",
        // "default-src" >> and nothing else, so with no `default-src` here the
        // browser fetches an application manifest from any host. `worker-src`
        // is also unnamed but is not a gap for the same reason: its chain is
        // << "worker-src", "child-src", "script-src", "default-src" >>, so
        // `script-src` above already constrains it.
        //
        // A `<link rel="manifest">` that named a third-party host would beacon
        // the visitor's IP, User-Agent and Referer there, and a manifest also
        // carries `name`, `icons`, `start_url` and `scope`, so an off-origin
        // one misrepresents the installed-app identity of the site. The link
        // this config emits above is root-relative (`${baseUrl}manifest.json`,
        // served from static/manifest.json), so 'self' constrains nothing the
        // site actually does -- the same premise that made `font-src 'self'`
        // safe to set.
        content: [
          "base-uri 'self'",
          "object-src 'none'",
          "frame-src 'none'",
          "media-src 'none'",
          "connect-src 'self'",
          "font-src 'self'",
          "manifest-src 'self'",
          "form-action 'self'",
          `script-src ${SCRIPT_SOURCES.join(' ')}`,
          "style-src 'self' 'unsafe-inline'",
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
          // crawler honours. The pattern is matched against the route after
          // trailingSlash is applied, so it must cover `/search/`.
          ignorePatterns: ['/search/**'],
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

          // Right
          {
            type: 'docSidebar',
            sidebarId: 'resourcesSidebar',
            position: 'right',
            label: 'Resources',
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
        theme: withAAContrast(prismThemes.github),
        darkTheme: withAAContrast(prismThemes.dracula),
      },
    }),
  plugins: [
    endusersRobotsTxt,
    E2E_SOURCE_MAP_PLUGIN,
    E2E_DATA_FIXTURE_PLUGIN,
    E2E_FIXTURE_DOCS_PLUGIN,
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
