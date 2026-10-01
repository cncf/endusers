// End-to-end coverage for the colour-mode machinery configured by
// `themeConfig.colorMode` in docusaurus.config.js: `defaultMode: 'light'` and
// `respectPrefersColorScheme: true`.
//
// Nothing in the suite has ever entered dark mode. tests/css-variables.test.mjs
// is the closest thing, and it reads src/css/custom.css off disk: it parses the
// declarations in the `:root` and `[data-theme='dark']` blocks and asserts the
// two declare the same token *names*. That is a source-level check on the
// stylesheet text. It never loads a page, never sets `data-theme`, and never
// resolves the cascade, so every failure below is invisible to it:
//
//   - `respectPrefersColorScheme` flipped to false, which silently pins a
//     dark-preferring visitor to the light palette;
//   - `defaultMode` changed, so a first-time visitor with no stored preference
//     and no OS preference lands in the wrong mode;
//   - the navbar toggle losing its three-way system -> light -> dark cycle, or
//     stopping at two states, after a theme upgrade or a swizzle;
//   - a chosen mode not surviving navigation, which is what makes the toggle
//     feel broken even when it works on the page you clicked it on.
//
// Computed site tokens also guard the cascade: selecting a theme is not enough
// if the site's dark overrides lose to the light root block.
import { test, expect } from '@playwright/test';

// docusaurus.config.js sets `colorMode.defaultMode: 'light'`.
const DEFAULT_MODE = 'light';

// Infima's own dark background token. Unlike the site's overrides in
// src/css/custom.css, this one is declared by Infima on both `:root` and
// `[data-theme=dark]` at equal specificity, so it is a faithful read of
// whether the dark palette is actually winning the cascade at runtime.
const BACKGROUND_TOKEN = '--ifm-background-color';

// The navbar colour-mode control. Docusaurus renders it as a button carrying a
// hashed CSS-module class, so it is matched on the stable part of that name
// rather than on its accessible name, which changes with the current mode.
function toggle(page) {
  return page.locator('nav.navbar button[class*="toggleButton"]').first();
}

function theme(page) {
  return page.locator('html');
}

async function backgroundToken(page) {
  return page.evaluate(
    (name) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    BACKGROUND_TOKEN,
  );
}

test.describe('colour mode', () => {
  test(`a visitor with no OS preference gets ${DEFAULT_MODE} mode`, async ({
    browser,
  }) => {
    // `colorScheme: 'no-preference'` is what a client that expresses no
    // preference looks like, so this reads `defaultMode` rather than the
    // prefers-color-scheme branch.
    const context = await browser.newContext({ colorScheme: 'no-preference' });
    const page = await context.newPage();

    await page.goto('/');
    await expect(theme(page)).toHaveAttribute('data-theme', DEFAULT_MODE);

    await context.close();
  });

  for (const palette of [
    {
      mode: 'light',
      primary: '#005ea8',
      button: '#005ea8',
      hover: '#004f91',
    },
    {
      mode: 'dark',
      primary: '#32d8b4',
      button: '#007f68',
      hover: '#006f5b',
    },
  ]) {
    test(`the ${palette.mode} site palette wins the cascade`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: palette.mode });
      await page.goto('/');
      await expect(theme(page)).toHaveAttribute('data-theme', palette.mode);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const style = getComputedStyle(document.documentElement);
            return {
              primary: style.getPropertyValue('--ifm-color-primary').trim(),
              button: style.getPropertyValue('--cncf-button-background').trim(),
              hover: style
                .getPropertyValue('--cncf-button-background-hover')
                .trim(),
            };
          }),
        )
        .toEqual({
          primary: palette.primary,
          button: palette.button,
          hover: palette.hover,
        });
      const decoration = (selector) =>
        page
          .locator(selector)
          .first()
          .evaluate((node) => getComputedStyle(node).textDecorationLine);
      expect(await decoration('.pillar p a')).toContain('underline');
      expect(await decoration('.audience-cta')).toBe('none');
      expect(await decoration('.navbar__link')).toBe('none');
      await page.goto('/metrics');
      expect(await decoration('a[class*="card"]')).toBe('none');
    });
  }

  test('a dark-preferring visitor gets dark mode on arrival', async ({
    browser,
  }) => {
    // `respectPrefersColorScheme: true` is the whole contract here: with it
    // set to false this lands in `defaultMode` instead, which builds clean and
    // is invisible to every existing test.
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();

    await page.goto('/');
    await expect(theme(page)).toHaveAttribute('data-theme', 'dark');

    await context.close();
  });

  test('a light-preferring visitor gets light mode on arrival', async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: 'light' });
    const page = await context.newPage();

    await page.goto('/');
    await expect(theme(page)).toHaveAttribute('data-theme', 'light');

    await context.close();
  });

  test('the navbar toggle cycles system, light and dark', async ({
    browser,
  }) => {
    // Started from a light-preferring client so the "system" state is
    // distinguishable from an explicit dark choice by the attribute alone.
    const context = await browser.newContext({ colorScheme: 'light' });
    const page = await context.newPage();

    await page.goto('/');

    const control = toggle(page);
    await expect(
      control,
      'the navbar should render exactly one colour-mode control',
    ).toBeVisible();

    // The control starts in the system state and advances one step per click,
    // returning to system on the third. A two-state toggle — which is what a
    // theme upgrade or a swizzle is most likely to leave behind — fails on the
    // third assertion.
    await control.click();
    await expect(
      theme(page),
      'the first click should select light mode explicitly',
    ).toHaveAttribute('data-theme', 'light');

    await control.click();
    await expect(
      theme(page),
      'the second click should select dark mode',
    ).toHaveAttribute('data-theme', 'dark');

    await control.click();
    await expect(
      theme(page),
      'the third click should return to following the system preference',
    ).toHaveAttribute('data-theme', 'light');

    await context.close();
  });

  test('a chosen mode survives navigation to another route', async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: 'light' });
    const page = await context.newPage();

    await page.goto('/');

    const control = toggle(page);
    await control.click();
    await control.click();
    await expect(theme(page)).toHaveAttribute('data-theme', 'dark');

    // A full document load rather than a client-side transition: the stored
    // preference has to be re-read and applied by the inline script Docusaurus
    // injects, which is the part that regresses independently of the toggle.
    await page.goto('/metrics/');
    await expect(
      theme(page),
      'the chosen mode should be restored on a fresh page load',
    ).toHaveAttribute('data-theme', 'dark');

    await page.goto('/blog');
    await expect(theme(page)).toHaveAttribute('data-theme', 'dark');

    await context.close();
  });

  test('dark mode resolves a different page background than light mode', async ({
    browser,
  }) => {
    // Guards that engaging dark mode has a rendered consequence, not just an
    // attribute change: `data-theme` can flip correctly while the dark
    // stylesheet fails to load or fails to win the cascade, and nothing else
    // in the suite looks at a computed value.
    const light = await browser.newContext({ colorScheme: 'light' });
    const lightPage = await light.newPage();
    await lightPage.goto('/');
    const lightBackground = await backgroundToken(lightPage);
    await light.close();

    const dark = await browser.newContext({ colorScheme: 'dark' });
    const darkPage = await dark.newPage();
    await darkPage.goto('/');
    await expect(theme(darkPage)).toHaveAttribute('data-theme', 'dark');
    const darkBackground = await backgroundToken(darkPage);
    await dark.close();

    expect(
      darkBackground,
      `${BACKGROUND_TOKEN} should resolve to a value in dark mode`,
    ).not.toBe('');
    expect(
      darkBackground,
      `${BACKGROUND_TOKEN} should differ between light and dark mode`,
    ).not.toBe(lightBackground);
  });
});
