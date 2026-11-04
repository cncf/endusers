// scripts/validate-survey-reports.mjs shares every check with the Radar
// validator through scripts/lib/cncf-reports.mjs; tests/validate-radar-reports.test.mjs
// drives each of those checks red. This file pins the Survey wiring: the file
// the script reads and the array key it validates inside it.

import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptWithFixtures } from './helpers.mjs';

const SCRIPT = 'validate-survey-reports.mjs';
const validData = {
  generatedAt: '2026-11-04T00:00:00.000Z',
  sourceUrl: 'https://www.cncf.io/reports?_sft_lf-report-type=survey',
  surveyReports: [
    {
      id: 1,
      title: 'Example Survey Report',
      slug: 'example-survey-report',
      url: 'https://www.cncf.io/reports/example-survey-report/',
      publishedAt: '2026-01-01',
      summary: 'A brief, real description of the survey.',
    },
  ],
};

test('accepts a minimal valid survey reports file', () => {
  const result = runScriptWithFixtures(SCRIPT, {
    'data/survey-reports.json': JSON.stringify(validData),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 survey reports/);
});

test('reads the surveyReports key, not the Radar one', () => {
  const { surveyReports, ...rest } = validData;
  const result = runScriptWithFixtures(SCRIPT, {
    'data/survey-reports.json': JSON.stringify({
      ...rest,
      radarReports: surveyReports,
    }),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /surveyReports must be a non-empty array/);
});
