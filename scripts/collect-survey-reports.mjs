#!/usr/bin/env node
// Collects the current CNCF Survey reports from the public cncf.io WordPress
// REST API and writes data/survey-reports.json. Run on a daily schedule by
// .github/workflows/refresh-radar-reports.yml so /resources/survey-reports
// stays in sync with https://www.cncf.io/reports?_sft_lf-report-type=survey.
// The machinery, shared with the Radar mirror, lives in
// scripts/lib/cncf-reports.mjs.
import { SURVEY_REPORTS, collectReports } from './lib/cncf-reports.mjs';

await collectReports(SURVEY_REPORTS);
