// End-to-end coverage for /metrics, the only route that renders
// src/components/MetricsDashboard. tests/e2e/smoke.spec.js already asserts
// that the page is not blank (freshness line, lifecycle heading, at least one
// outbound link); everything below is the part of the dashboard that the
// smoke test leaves untouched.
//
// tests/metrics-dashboard.test.mjs reports full unit line and region coverage
// for the component, but it drives the JSX through tests/tools/fake-dom.mjs:
// no stylesheet is ever resolved, no <details> element ever toggles, and no
// SVG is ever laid out. Three of the dashboard's behaviours only exist in a
// real engine and so cannot be observed by that suite at all:
//
//   * the breakdown bar widths, which are a `--bar-width` custom property the
//     browser has to resolve against .track before the bar has any size;
//   * the "What is not yet measurable" disclosure, whose collapsed/expanded
//     behaviour is supplied by the <details> element rather than by component
//     code;
//   * the SVG plot geometry, which the component emits as raw coordinate
//     strings and the browser turns into a rendered box.
//
// The dashboard is also regenerated on a schedule by `npm run collect:metrics`
// from public CNCF repositories, so its data can change with no source change
// at all. These cases therefore assert shape and invariants against
// data/metrics.json rather than against any particular published number.
import { test, expect } from '@playwright/test';
import metricsData from '../../data/metrics.json';

const METRICS_PATH = '/metrics';

test.describe('metrics dashboard headline cards', () => {
  test('renders one outbound card per headline metric', async ({ page }) => {
    await page.goto(METRICS_PATH);

    for (const metric of metricsData.metrics) {
      const card = page.locator(`a[href="${metric.sourceUrl}"]`).filter({
        hasText: metric.label,
      });
      await expect(card).toBeVisible();
      await expect(card).toContainText(metric.value.toLocaleString());
      await expect(card).toContainText(`Source: ${metric.source}`);
    }
  });

  test('no outbound link can reach back through window.opener', async ({
    page,
  }) => {
    await page.goto(METRICS_PATH);

    // The component sets rel="noreferrer" on every target="_blank" link. In a
    // real engine that is what severs opener access, so assert it against the
    // hydrated document rather than against the JSX.
    const newTabLinks = page.locator('a[target="_blank"]');
    const count = await newTabLinks.count();
    expect(count).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const rel = await newTabLinks.nth(index).getAttribute('rel');
      expect(rel ?? '').toMatch(/noreferrer/);
    }
  });
});

test.describe('metrics dashboard line charts', () => {
  test('each series is a labelled region with its own heading and source', async ({
    page,
  }) => {
    await page.goto(METRICS_PATH);

    for (const [id, series] of Object.entries(metricsData.series || {})) {
      const section = page.locator(`section[aria-labelledby="${id}-title"]`);
      await expect(section).toBeVisible();
      await expect(
        section.getByRole('heading', { name: series.label }),
      ).toBeVisible();
      await expect(
        section.locator(`a[href="${series.sourceUrl}"]`),
      ).toHaveCount(1);
      await expect(
        section.getByRole('img', { name: `${series.label} over time` }),
      ).toBeVisible();
    }
  });

  test('plotted points stay inside the rendered chart box', async ({
    page,
  }) => {
    await page.goto(METRICS_PATH);

    for (const [id, series] of Object.entries(metricsData.series || {})) {
      if (!series.values?.length) continue;

      const svg = page.locator(`section[aria-labelledby="${id}-title"] svg`);
      await expect(svg).toBeVisible();

      // The component computes cx/cy against a declared 520x220 viewBox. Once
      // the browser has scaled that viewBox to the laid-out element, every
      // point must still land within the visible chart; a geometry regression
      // would push markers outside it.
      //
      // The chart and its markers are measured in one evaluate so they are
      // read from a single layout pass: separate boundingBox() calls can
      // straddle a reflow and compare boxes that never coexisted.
      const geometry = await svg.evaluate((node) => {
        const chart = node.getBoundingClientRect();
        return {
          chart: {
            left: chart.left,
            top: chart.top,
            right: chart.right,
            bottom: chart.bottom,
          },
          points: [...node.querySelectorAll('circle')].map((circle) => {
            const box = circle.getBoundingClientRect();
            return {
              left: box.left,
              top: box.top,
              right: box.right,
              bottom: box.bottom,
            };
          }),
        };
      });

      expect(geometry.points).toHaveLength(series.values.length);
      const tolerance = 1;
      for (const point of geometry.points) {
        expect(point.left).toBeGreaterThanOrEqual(
          geometry.chart.left - tolerance,
        );
        expect(point.top).toBeGreaterThanOrEqual(
          geometry.chart.top - tolerance,
        );
        expect(point.right).toBeLessThanOrEqual(
          geometry.chart.right + tolerance,
        );
        expect(point.bottom).toBeLessThanOrEqual(
          geometry.chart.bottom + tolerance,
        );
      }
    }
  });

  test('every plotted point carries a hoverable date and value', async ({
    page,
  }) => {
    await page.goto(METRICS_PATH);

    for (const [id, series] of Object.entries(metricsData.series || {})) {
      if (!series.values?.length) continue;

      const titles = page.locator(
        `section[aria-labelledby="${id}-title"] svg circle title`,
      );
      await expect(titles).toHaveCount(series.values.length);

      const firstPoint = series.values[0];
      await expect(titles.first()).toHaveText(
        `${firstPoint.date}: ${firstPoint.value}`,
      );
    }
  });

  test('the range row reports the first and last observation', async ({
    page,
  }) => {
    await page.goto(METRICS_PATH);

    for (const [id, series] of Object.entries(metricsData.series || {})) {
      if (!series.values?.length) continue;

      const section = page.locator(`section[aria-labelledby="${id}-title"]`);
      const lastValue = series.values.at(-1);
      await expect(section).toContainText(series.values[0].date);
      await expect(section).toContainText(lastValue.date);
      await expect(section.locator('strong')).toContainText(
        lastValue.value.toLocaleString(),
      );
    }
  });
});

test.describe('metrics dashboard breakdown charts', () => {
  test('each breakdown is exposed to assistive technology as a list', async ({
    page,
  }) => {
    await page.goto(METRICS_PATH);

    for (const [id, chart] of Object.entries(metricsData.breakdowns || {})) {
      const section = page.locator(`section[aria-labelledby="${id}-title"]`);
      await expect(
        section.getByRole('heading', { name: chart.label }),
      ).toBeVisible();

      const rows = section.getByRole('listitem');
      await expect(rows).toHaveCount(chart.values.length);
      await expect(rows.first()).toContainText(chart.values[0].name);
      await expect(rows.first()).toContainText(String(chart.values[0].value));
    }
  });

  test('bar widths resolve in the browser and rank by value', async ({
    page,
  }) => {
    await page.goto(METRICS_PATH);

    for (const [id, chart] of Object.entries(metricsData.breakdowns || {})) {
      if (chart.values.length < 2) continue;

      const section = page.locator(`section[aria-labelledby="${id}-title"]`);
      await expect(section).toBeVisible();

      // The fake-DOM unit suite can only read the inline custom property back
      // as a string. Here the engine has actually resolved it, so a bar with a
      // real width proves the stylesheet and the custom property agree. All
      // bars are measured in one layout pass so their widths are comparable.
      const widths = await section.evaluate((node) =>
        [
          ...node.querySelectorAll(
            '[role="listitem"] span[style*="--bar-width"]',
          ),
        ].map((bar) => bar.getBoundingClientRect().width),
      );

      expect(widths).toHaveLength(chart.values.length);
      expect(widths[0]).toBeGreaterThan(0);

      const leadingValue = chart.values[0].value;
      const trailingValue = chart.values.at(-1).value;
      if (trailingValue < leadingValue) {
        expect(widths.at(-1)).toBeLessThan(widths[0]);
      }
    }
  });
});

test.describe('reference architecture lifecycle panel', () => {
  test('renders one card per leading indicator', async ({ page }) => {
    await page.goto(METRICS_PATH);

    const lifecycle = metricsData.referenceArchitectureLifecycle;
    const section = page.locator('section[aria-labelledby="lifecycle-title"]');
    await expect(section).toBeVisible();

    for (const card of lifecycle?.cards || []) {
      const rendered = section.locator('div').filter({ hasText: card.label });
      await expect(rendered.first()).toContainText(card.value.toLocaleString());
      if (card.suffix) {
        await expect(rendered.first()).toContainText(card.suffix);
      }
    }
  });

  test('each trend gets a sparkline announcing the period it covers', async ({
    page,
  }) => {
    await page.goto(METRICS_PATH);

    const trends = metricsData.referenceArchitectureLifecycle?.trends || {};
    const section = page.locator('section[aria-labelledby="lifecycle-title"]');

    for (const trend of Object.values(trends)) {
      await expect(section).toContainText(trend.label);

      if (!trend.values?.length) {
        continue;
      }
      const label = `Trend from ${trend.values[0].date} to ${trend.values.at(-1).date}`;
      await expect(section.getByRole('img', { name: label })).toBeVisible();
    }
  });

  test('what is not yet measurable stays collapsed until it is opened', async ({
    page,
  }) => {
    await page.goto(METRICS_PATH);

    const omitted = metricsData.referenceArchitectureLifecycle?.omitted || [];
    test.skip(omitted.length === 0, 'no omitted lifecycle indicators to show');

    const disclosure = page
      .locator('section[aria-labelledby="lifecycle-title"] details')
      .first();
    const summary = disclosure.getByText('What is not yet measurable');
    await expect(summary).toBeVisible();

    // <details> supplies the collapse; the component contributes no script for
    // it, so this is only observable in a real engine.
    const hidden = disclosure.getByText(omitted[0].reason, { exact: false });
    await expect(hidden).toBeHidden();

    await summary.click();
    await expect(hidden).toBeVisible();
    for (const item of omitted) {
      await expect(disclosure).toContainText(item.id);
    }
  });
});

test.describe('metrics dashboard transparency note', () => {
  test('discloses every omitted metric rather than dropping it', async ({
    page,
  }) => {
    await page.goto(METRICS_PATH);

    await expect(page.getByText('Data coverage')).toBeVisible();
    for (const item of metricsData.omitted) {
      await expect(page.getByText(`${item.id}: ${item.reason}`)).toBeVisible();
    }
  });
});
