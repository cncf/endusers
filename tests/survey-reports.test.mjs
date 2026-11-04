// src/components/SurveyReports/index.js is the Survey twin of RadarReports:
// both hand a mirrored corpus to the shared <ReportList /> in
// src/components/shared, whose rendering contract (one item per report, the
// provenance line, the new-tab link hygiene and the missing-field fallbacks)
// tests/radar-reports.test.mjs and tests/radar-reports-fallbacks.test.mjs pin
// through the Radar page. What is left to guard here is the wiring: that the
// Survey page reads data/survey-reports.json, the `surveyReports` array in
// it, and labels its landmark as surveys rather than Radar.

import assert from 'node:assert/strict';
import test from 'node:test';

import { importSource } from './helpers-jsx.mjs';
import { findAllByType, renderElement } from './tools/react-element-tree.mjs';

const { default: SurveyReports } = await importSource(
  'src/components/SurveyReports/index.js',
);
const { default: ReportList } = await importSource(
  'src/components/shared/ReportList.js',
);
const { default: data } = await importSource('data/survey-reports.json');

test('the survey page renders the shared report list over the survey corpus', () => {
  const element = SurveyReports();
  assert.equal(element.type, ReportList);
  assert.equal(element.props.data, data);
  assert.equal(element.props.listKey, 'surveyReports');
  assert.equal(element.props.ariaLabel, 'CNCF survey reports');
});

test('one list item is rendered per mirrored survey report', () => {
  const tree = renderElement(SurveyReports());
  assert.equal(tree.props['aria-label'], 'CNCF survey reports');
  assert.ok(data.surveyReports.length > 0, 'expected a non-empty corpus');
  assert.equal(findAllByType(tree, 'li').length, data.surveyReports.length);
});
