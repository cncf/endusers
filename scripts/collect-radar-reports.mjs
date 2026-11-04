#!/usr/bin/env node
// Collects the current CNCF Radar reports from the public cncf.io WordPress
// REST API and writes data/radar-reports.json. Run on a daily schedule by
// .github/workflows/refresh-radar-reports.yml so /resources/radar-reports
// stays in sync with https://www.cncf.io/reports?_sft_lf-report-type=radar.
// The machinery, shared with the Survey mirror, lives in
// scripts/lib/cncf-reports.mjs.
import { RADAR_REPORTS, collectReports } from './lib/cncf-reports.mjs';

await collectReports(RADAR_REPORTS);
