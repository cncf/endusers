#!/usr/bin/env node
// Validates data/radar-reports.json; the checks are shared with the Survey
// mirror in scripts/lib/cncf-reports.mjs.
import { RADAR_REPORTS, validateReports } from './lib/cncf-reports.mjs';

validateReports(RADAR_REPORTS);
