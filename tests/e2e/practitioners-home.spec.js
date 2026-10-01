// End-to-end coverage for the landing page itself (docs/practitioners/index.md,
// served at `/` via its `slug: /` frontmatter).
//
// `/` is the most-visited route on the site and the only one no spec asserts
// the content of. tests/e2e/navigation.spec.js loads it, but only to exercise
// the navbar that the theme renders around it; tests/e2e/footer.spec.js loads
// it, but only to exercise the footer. Everything between the two — the hero,
// the four pillars, the award photo, the "Start here" links, the page's own
// <ProjectsBorn> instance, the four audience cards and the five-step
// contribution ladder — is hand-authored JSX inside an MDX document, and no
// unit test renders it: tests/mdx-components.test.mjs parses the file as text
// and tests/projects-born-render.test.mjs drives the component in isolation
// with default props.
//
// That leaves a real gap. The hero image is pulled in through
// `require('@site/static/img/...')`, so it survives a build but breaks on a
// webpack asset-pipeline change; the internal links are plain literals that no
// broken-link check reaches once they are inside raw JSX; and the landing
// page's <ProjectsBorn> passes a custom `title`/`intro` that the isolated unit
// test never supplies. Each of these fails only in a browser against `build/`.
import { test, expect } from '../tools/e2e-coverage.cjs';

// Rendered by ProjectsBorn only when `compact` is false, which is how
// docs/practitioners/index.md uses it. The footer's compact strip on the same
// page carries `projects-born-title-footer` instead, so this id is what keeps
// the two instances apart.
const PAGE_SECTION = 'section[aria-labelledby="projects-born-title-section"]';

// The "Start here" list, in document order. These are written as literal
// hrefs inside a Markdown list, so they are reachable by Docusaurus' broken
// link check — but the list is also the site's primary wayfinding, and a
// route rename that updates the sidebar without updating this list leaves
// every new visitor on a dead end.
const START_HERE = [
  { label: 'Reference Architectures', href: '/architectures/' },
  { label: 'Community', href: '/community/' },
  { label: 'Awards', href: '/community/awards/' },
  { label: 'Metrics', href: '/metrics/' },
  { label: 'Events', href: '/events/' },
];

const PILLARS = [
  'Work with proven leaders',
  'Stay ahead of change',
  'Sustain open source',
  'Elevate your platform teams',
];

const AUDIENCE_CARDS = [
  {
    heading: 'For practitioners and engineers',
    cta: 'Join the Slack conversation',
    href: 'https://slack.cncf.io/',
  },
  {
    heading: 'For architects',
    cta: 'Start a reference architecture',
    href: 'https://github.com/cncf/tab/blob/main/process/reference-architectures.md',
  },
  {
    heading: 'For engineering leaders',
    cta: 'Learn about membership',
    href: 'https://www.cncf.io/enduser/',
  },
  {
    heading: 'For organizations considering CNCF',
    cta: 'Read case studies',
    href: 'https://www.cncf.io/case-studies/',
  },
];

const LADDER_STEPS = [
  'Listen and connect',
  'Show up',
  'Share what you know',
  'Contribute a reference architecture',
  'Help shape direction',
];

function article(page) {
  return page.locator('article').first();
}

async function expectNotNotFound(page) {
  await expect(
    page.getByRole('heading', { name: 'Page Not Found' }),
  ).toHaveCount(0);
}

test.describe('landing page hero', () => {
  test('serves the practitioners doc at the site root', async ({ page }) => {
    const response = await page.goto('/');

    expect(response?.status(), '/ should not 404').toBeLessThan(400);
    await expectNotNotFound(page);
    await expect(
      page.getByRole('heading', { level: 1, name: 'CNCF End Users' }),
    ).toBeVisible();
  });

  test('renders the tagline with its emphasised second clause', async ({
    page,
  }) => {
    await page.goto('/');

    // The tagline is one <p> with an inner <span> the stylesheet sets apart.
    // Asserting the span separately catches an MDX change that flattens the
    // markup and silently drops the styling.
    const tagline = article(page).locator('p.hero-tagline');
    await expect(tagline).toBeVisible();
    await expect(tagline).toContainText('Proven performance in production');
    await expect(tagline.locator('span')).toHaveText(
      'by the organizations running cloud native at scale',
    );
  });

  test('renders all four value pillars', async ({ page }) => {
    await page.goto('/');

    const pillars = article(page).locator('.pillars > .pillar');
    await expect(pillars).toHaveCount(PILLARS.length);

    for (const [index, heading] of PILLARS.entries()) {
      const pillar = pillars.nth(index);
      await expect(pillar.locator('h3')).toHaveText(heading);
      // Every pillar carries a body paragraph; an empty one is the shape a
      // truncated MDX edit leaves behind.
      await expect(pillar.locator('p')).not.toBeEmpty();
    }
  });

  test('the award photo decodes and credits the awards page', async ({
    page,
  }) => {
    await page.goto('/');

    const figure = article(page).locator('figure.hero-photo');
    await expect(figure).toBeVisible();

    const image = figure.locator('img');
    await expect(image).toHaveAttribute('alt', /Top End User Award/);

    // `require()`d images are emitted by webpack under a hashed name. A
    // missing emit still renders an <img> with a plausible src, so the only
    // reliable signal is whether the browser actually decoded pixels.
    await expect
      .poll(async () => image.evaluate((node) => node.naturalWidth))
      .toBeGreaterThan(0);

    await expect(
      figure.locator(
        'figcaption a[href="/community/awards"], figcaption a[href="/community/awards/"]',
      ),
    ).toBeVisible();
  });
});

test.describe('landing page wayfinding', () => {
  for (const { label, href } of START_HERE) {
    test(`"Start here" offers ${label} and it resolves`, async ({ page }) => {
      await page.goto('/');

      const link = article(page).getByRole('link', {
        name: label,
        exact: true,
      });
      await expect(link.first()).toHaveAttribute(
        'href',
        new RegExp(`^${href.replace(/\/$/, '')}/?$`),
      );

      const response = await page.goto(href);
      expect(response?.status(), `${href} should not 404`).toBeLessThan(400);
      await expectNotNotFound(page);
      await expect(page.locator('article').first()).toBeVisible();
    });
  }

  test('renders the four audience cards with their calls to action', async ({
    page,
  }) => {
    await page.goto('/');

    const cards = article(page).locator('.audience-cards > .audience-card');
    await expect(cards).toHaveCount(AUDIENCE_CARDS.length);

    for (const [index, card] of AUDIENCE_CARDS.entries()) {
      const node = cards.nth(index);
      await expect(node.locator('h3')).toHaveText(card.heading);

      const cta = node.locator('a.audience-cta');
      await expect(cta).toHaveText(card.cta);
      await expect(cta).toHaveAttribute('href', card.href);
    }
  });

  test('renders the contribution ladder as five numbered steps', async ({
    page,
  }) => {
    await page.goto('/');

    const steps = article(page).locator('.ladder > .ladder-step');
    await expect(steps).toHaveCount(LADDER_STEPS.length);

    for (const [index, heading] of LADDER_STEPS.entries()) {
      const step = steps.nth(index);
      // The visible number is hand-written per step, so it can drift out of
      // order under an insertion; the position and the label must agree.
      await expect(step.locator('.ladder-number')).toHaveText(
        String(index + 1),
      );
      await expect(step.locator('h3')).toHaveText(heading);
    }
  });
});

test.describe('landing page projects-born section', () => {
  test('uses the page-specific title and intro rather than the defaults', async ({
    page,
  }) => {
    await page.goto('/');

    const section = page.locator(PAGE_SECTION);
    await expect(section).toBeVisible();
    await expect(section.locator('#projects-born-title-section')).toHaveText(
      'Lead the way, set the industry standard',
    );

    // The component's default title belongs to the footer's compact strip on
    // this page; the in-page section falling back to it is the regression.
    await expect(
      section.getByText('Projects born at end-user organizations', {
        exact: true,
      }),
    ).toHaveCount(0);

    await expect(section).toContainText(
      'These projects prove that cloud native end users are at the leading edge',
    );
    await expect(section.locator('p').first()).toHaveText(
      'Production becomes open source',
    );
  });

  test('lists every shipped project with its origin and destination', async ({
    page,
  }) => {
    await page.goto('/');

    const section = page.locator(PAGE_SECTION);
    const links = section.getByRole('link', { name: /Born at / });

    // Both instances render the same data/projects-born.json, so the footer
    // strip on this very page is the count to hold the section against: it
    // pins the section to the shipped data without restating it here.
    const shipped = await page
      .locator('section[aria-labelledby="projects-born-title-footer"]')
      .getByRole('link', { name: /Born at / })
      .count();
    expect(shipped).toBeGreaterThan(0);
    await expect(links).toHaveCount(shipped);

    for (let index = 0; index < shipped; index += 1) {
      const link = links.nth(index);
      await expect(link).toHaveAttribute('href', /^https?:\/\//);
      await expect(link.locator('[class*="projectName"]')).not.toBeEmpty();
      await expect(link).toContainText(/Born at \S/);
      // The full-width variant adds a description the compact strip omits;
      // losing it is how a `compact` regression would show up here.
      await expect(link.locator('[class*="projectDescription"]')).toBeVisible();
    }
  });

  test('is distinct from the compact strip the footer renders', async ({
    page,
  }) => {
    await page.goto('/');

    // Both instances are on this page. If ProjectsBorn ever computes one id
    // for both, the sections collide and `aria-labelledby` stops naming them
    // apart for assistive technology.
    await expect(page.locator(PAGE_SECTION)).toHaveCount(1);
    await expect(
      page.locator('section[aria-labelledby="projects-born-title-footer"]'),
    ).toHaveCount(1);
  });
});
