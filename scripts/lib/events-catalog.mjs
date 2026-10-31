// The front matter of docs/events/<year>/<slug>.md is the only place an
// event's metadata is written (ADR 0012). This module is the only code that
// reads it: sidebars.js builds the events sidebar from collectEvents() and
// src/plugins/events-catalog.mjs publishes the same list as plugin global
// data for the EventsIndex component, so the two orderings cannot disagree.
//
// There is no committed catalog file. Nothing outside the Docusaurus build
// reads the list, so a generated JSON would have no consumer except the build
// that could have read the pages directly.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitFrontMatter } from './architecture-frontmatter.mjs';

/** The key the event metadata nests under in a page's front matter. */
const FRONT_MATTER_KEY = 'event';

/** The docs directory the event pages live under, relative to docs/. */
const EVENTS_DIR = 'events';

/** Page extensions @docusaurus/plugin-content-docs globs by default. */
const PAGE_EXTENSION = /\.mdx?$/;

const YEAR_DIR = /^\d{4}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Thrown for a page that breaks the event front matter contract. The message
 * names the page and the rule so the author sees the file they edited.
 */
export class EventPageError extends Error {
  /**
   * @param {string} page - Path of the page relative to the docs directory.
   * @param {string} rule
   */
  constructor(page, rule) {
    super(`docs/${page}: ${rule}`);
    this.name = 'EventPageError';
    this.page = page;
  }
}

// A calendar date must both match the ISO shape and name a real day: the
// Date round-trip rejects `2026-02-30` as well as a month of 13.
function isCalendarDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function requireString(page, data, key, label = `"${key}"`) {
  if (!isNonEmptyString(data[key])) {
    throw new EventPageError(
      page,
      `front matter ${label} must be a non-empty string`,
    );
  }
  return data[key].trim();
}

/**
 * Builds one event record from a page's parsed front matter, enforcing the
 * contract ADR 0012 states: `title` and `description` at the top level, and
 * under `event:` ISO calendar dates `start` and `end` with `end >= start`,
 * a `location` and an absolute `url`, with the year directory equal to the
 * year of `start`.
 *
 * @param {string} year - The page's year directory name.
 * @param {string} slug - The page's file name without extension.
 * @param {Record<string, unknown> | null} data - Parsed front matter.
 * @returns {EventRecord}
 */
export function recordFromFrontMatter(year, slug, data) {
  const page = `${EVENTS_DIR}/${year}/${slug}.md`;
  if (!data) {
    throw new EventPageError(page, 'front matter must be a YAML mapping');
  }
  const title = requireString(page, data, 'title');
  const description = requireString(page, data, 'description');
  const event = data[FRONT_MATTER_KEY];
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new EventPageError(
      page,
      `front matter must carry an "${FRONT_MATTER_KEY}:" mapping`,
    );
  }
  for (const key of ['start', 'end']) {
    if (!isCalendarDate(event[key])) {
      throw new EventPageError(
        page,
        `${FRONT_MATTER_KEY}.${key} must be an ISO calendar date (YYYY-MM-DD)`,
      );
    }
  }
  if (event.end < event.start) {
    throw new EventPageError(
      page,
      `${FRONT_MATTER_KEY}.end (${event.end}) is before ${FRONT_MATTER_KEY}.start (${event.start})`,
    );
  }
  if (event.start.slice(0, 4) !== year) {
    throw new EventPageError(
      page,
      `${FRONT_MATTER_KEY}.start (${event.start}) is not in the page's year directory (${year})`,
    );
  }
  const location = requireString(
    page,
    event,
    'location',
    `${FRONT_MATTER_KEY}.location`,
  );
  const url = requireString(page, event, 'url', `${FRONT_MATTER_KEY}.url`);
  if (!/^https?:\/\//.test(url)) {
    throw new EventPageError(
      page,
      `${FRONT_MATTER_KEY}.url must be an absolute http(s) URL`,
    );
  }
  return {
    id: `${year}/${slug}`,
    docId: `${EVENTS_DIR}/${year}/${slug}`,
    route: `/${EVENTS_DIR}/${year}/${slug}`,
    year: Number(year),
    title,
    description,
    start: event.start,
    end: event.end,
    location,
    url,
  };
}

/**
 * Latest event first: by `start` descending, then `end` descending, then
 * title ascending so two events that share both dates have a stable order.
 *
 * @param {EventRecord} a
 * @param {EventRecord} b
 * @returns {number}
 */
export function compareEvents(a, b) {
  if (a.start !== b.start) return a.start < b.start ? 1 : -1;
  if (a.end !== b.end) return a.end < b.end ? 1 : -1;
  return a.title.localeCompare(b.title, 'en');
}

/**
 * Reads every event page under `<docsDir>/events/<year>/` and returns the
 * validated records, latest first. The events directory's own index page and
 * anything that is not a four-digit year directory are left alone; only
 * `.md`/`.mdx` files inside a year directory are events.
 *
 * @param {string} docsDir - Absolute path to the docs directory.
 * @returns {EventRecord[]}
 */
export function collectEvents(docsDir) {
  const eventsDir = join(docsDir, EVENTS_DIR);
  const records = [];
  for (const entry of readdirSync(eventsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !YEAR_DIR.test(entry.name)) continue;
    const yearDir = join(eventsDir, entry.name);
    for (const page of readdirSync(yearDir, { withFileTypes: true })) {
      if (!page.isFile() || !PAGE_EXTENSION.test(page.name)) continue;
      const slug = page.name.replace(PAGE_EXTENSION, '');
      const { data } = splitFrontMatter(
        readFileSync(join(yearDir, page.name), 'utf8'),
      );
      records.push(recordFromFrontMatter(entry.name, slug, data));
    }
  }
  return records.sort(compareEvents);
}

/**
 * Groups latest-first records by year, newest year first. The input order is
 * preserved within a year, so passing collectEvents() output keeps each
 * year's events latest-first too.
 *
 * @param {EventRecord[]} events
 * @returns {Array<{ year: number, events: EventRecord[] }>}
 */
export function groupByYear(events) {
  const byYear = new Map();
  for (const event of events) {
    if (!byYear.has(event.year)) byYear.set(event.year, []);
    byYear.get(event.year).push(event);
  }
  return Array.from(byYear, ([year, grouped]) => ({
    year,
    events: grouped,
  })).sort((a, b) => b.year - a.year);
}

/**
 * @typedef {object} EventRecord
 * @property {string} id - `<year>/<slug>`
 * @property {string} docId - Docusaurus doc id, `events/<year>/<slug>`
 * @property {string} route - Site route, `/events/<year>/<slug>`
 * @property {number} year
 * @property {string} title
 * @property {string} description
 * @property {string} start - ISO calendar date
 * @property {string} end - ISO calendar date
 * @property {string} location
 * @property {string} url
 */

/**
 * The events sidebar: the section index, then one collapsible category per
 * year, newest year first, each listing its event pages latest first. Built
 * from the same groups the EventsIndex component renders, so the index and
 * the sidebar cannot disagree (ADR 0012). Only the newest year starts
 * expanded.
 *
 * @param {ReturnType<typeof groupByYear>} years
 * @returns {import('@docusaurus/plugin-content-docs').SidebarsConfig[string]}
 */
export function eventsSidebarItems(years) {
  return [
    'events/index',
    ...years.map(({ year, events }, index) => ({
      type: /** @type {const} */ ('category'),
      label: String(year),
      collapsible: true,
      collapsed: index !== 0,
      items: events.map((event) => event.docId),
    })),
  ];
}
