// @ts-check
// `@type` JSDoc annotations allow editor autocompletion and type checking
// (when paired with `@ts-check`).
// There are various equivalent ways to declare your Docusaurus config.
// See: https://docusaurus.io/docs/api/docusaurus-config

import { themes as prismThemes } from 'prism-react-renderer';

const siteUrl = process.env.SITE_URL || 'https://endusers.cncf.io';
const baseUrl = process.env.BASE_URL || '/';

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
        href: '/manifest.json',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: '/favicons/apple-touch-icon.png',
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
            to: '/community/end-user-community#projects-born-at-end-user-organizations',
            label: 'Projects from end users',
            position: 'left',
          },
          {
            to: '/members/',
            label: 'Members',
            position: 'left',
          },
          {
            to: '/awards/',
            label: 'Awards',
            position: 'left',
          },

          // Right
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
  plugins: [require.resolve('docusaurus-plugin-search-local')],
};

export default config;
