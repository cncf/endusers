// scripts/collect-survey-reports.mjs is the Survey entry point into the
// collector shared with Radar in scripts/lib/cncf-reports.mjs. The page walk,
// the summary preservation, the newest-first sort and the no-change short
// circuit are pinned by tests/collect-radar-reports.test.mjs through the Radar
// entry point; this file guards what differs: the term the script resolves,
// the file and key it writes, and the listing it credits as its source.

import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptInSandbox } from './helpers-script-sandbox.mjs';

const OUTPUT = 'data/survey-reports.json';

test('writes a survey catalog keyed off the discovered survey term id', () => {
  const result = runScriptInSandbox({
    script: 'collect-survey-reports.mjs',
    routes: [
      {
        match: 'lf_report',
        body: [
          {
            id: 9,
            slug: 'survey-one',
            link: 'https://www.cncf.io/reports/survey-one/',
            title: { rendered: 'Survey &amp; One' },
            date: '2025-01-02T03:04:05',
          },
        ],
      },
      {
        match: 'lf-report-type',
        body: [
          { id: 42, slug: 'radar', name: 'Radar' },
          { id: 43, slug: 'survey', name: 'Survey' },
        ],
      },
    ],
    outputs: [OUTPUT],
  });
  assert.equal(result.status, 0, result.stderr);
  const catalog = JSON.parse(result.outputs[OUTPUT]);
  assert.equal(catalog.source, 'cncf.io reports (Survey type)');
  assert.equal(
    catalog.sourceUrl,
    'https://www.cncf.io/reports?_sft_lf-report-type=survey',
  );
  // The Survey term id, not Radar's, must drive the post query.
  assert.equal(
    catalog.apiUrl,
    'https://www.cncf.io/wp-json/wp/v2/lf_report?lf-report-type=43',
  );
  assert.match(catalog.description, /\/resources\/survey-reports/);
  assert.equal(catalog.radarReports, undefined);
  assert.deepEqual(
    catalog.surveyReports.map(({ id, title, publishedAt }) => [
      id,
      title,
      publishedAt,
    ]),
    [[9, 'Survey & One', '2025-01-02']],
  );
  assert.match(result.stdout, /Collected 1 survey reports at /);
});

test('fails loudly when cncf.io no longer exposes a survey term', () => {
  const result = runScriptInSandbox({
    script: 'collect-survey-reports.mjs',
    routes: [{ match: 'lf-report-type', body: [{ id: 42, slug: 'radar' }] }],
    outputs: [OUTPUT],
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /lf-report-type term with slug "survey"/);
});
