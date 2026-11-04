#!/usr/bin/env node
// Validates data/survey-reports.json; the checks are shared with the Radar
// mirror in scripts/lib/cncf-reports.mjs.
import { SURVEY_REPORTS, validateReports } from './lib/cncf-reports.mjs';

validateReports(SURVEY_REPORTS);
