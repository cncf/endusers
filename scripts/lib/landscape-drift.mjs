/**
 * Compares the committed cncf/landscape snapshot in data/enduser-landscape.json
 * against a freshly classified landscape document.
 *
 * `npm run collect:enduser-members` pins the upstream revision, and
 * `npm run generate:members` turns that pin into the member directory the site
 * renders. Both run only from the on-demand "Refresh metrics" workflow, so the
 * pin stays exactly as old as the last time someone pressed the button. Every
 * validator keeps passing while it ages: the committed file is still
 * well-formed, still internally consistent, and simply no longer describes the
 * upstream it mirrors.
 *
 * This module is the missing question. It is pure so the answer can be tested
 * without the network: the caller owns cloning and classifying, and passes two
 * record arrays of the shape classifyLandscapeDocument produces.
 */

// The fields of an included record that reach a visitor: the organisation's
// name and link in the directory, and the role that decides which list it
// appears in. A change to any of them is directory content that is now wrong,
// not bookkeeping.
export const RENDERED_FIELDS = ['displayName', 'homepageUrl', 'sourceRole'];

/**
 * Index the included records of a classification by their upstream identity.
 *
 * @param {Array<object>} records classifyLandscapeDocument output records
 * @returns {Map<string, object>} sourceId -> record, included records only
 */
function selected(records) {
  const bySourceId = new Map();
  for (const record of records || []) {
    if (record?.included === true) bySourceId.set(record.sourceId, record);
  }
  return bySourceId;
}

/**
 * The drift between a pinned snapshot and a fresh classification.
 *
 * @param {Array<object>} pinnedRecords records from the committed snapshot
 * @param {Array<object>} freshRecords records classified from upstream now
 * @returns {{added: object[], removed: object[], changed: object[]}}
 *   `added` are organisations upstream selects that the site does not show,
 *   `removed` are organisations the site still shows that upstream no longer
 *   selects, and `changed` are organisations whose rendered fields differ.
 *   Every list is sorted by sourceId so a report reads the same way twice.
 */
export function diffLandscapeSelection(pinnedRecords, freshRecords) {
  const pinned = selected(pinnedRecords);
  const fresh = selected(freshRecords);

  // Both lists are walked in sorted source-id order rather than sorted
  // afterwards, so a report reads the same way twice without a comparator of
  // its own.
  const added = [];
  const changed = [];
  for (const sourceId of [...fresh.keys()].sort()) {
    const record = fresh.get(sourceId);
    const before = pinned.get(sourceId);
    if (!before) {
      added.push(record);
      continue;
    }
    const fields = RENDERED_FIELDS.filter(
      (field) => before[field] !== record[field],
    );
    if (fields.length > 0) changed.push({ sourceId, record, before, fields });
  }

  const removed = [];
  for (const sourceId of [...pinned.keys()].sort()) {
    if (!fresh.has(sourceId)) removed.push(pinned.get(sourceId));
  }

  return { added, removed, changed };
}

/**
 * Whether a diff found anything the member directory should be refreshed for.
 *
 * @param {{added: object[], removed: object[], changed: object[]}} diff
 * @returns {boolean}
 */
export function hasDrift(diff) {
  return (
    diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0
  );
}

/**
 * Render a diff as the lines a check prints, most actionable first.
 *
 * @param {{added: object[], removed: object[], changed: object[]}} diff
 * @returns {string[]} one line per drifting organisation, empty when in sync
 */
export function formatDrift(diff) {
  const lines = [];
  for (const record of diff.added) {
    lines.push(
      `missing from the directory: ${record.displayName} (${record.sourceRole}) — ${record.sourceId}`,
    );
  }
  for (const record of diff.removed) {
    lines.push(
      `no longer selected upstream: ${record.displayName} (${record.sourceRole}) — ${record.sourceId}`,
    );
  }
  for (const { record, before, fields } of diff.changed) {
    const detail = fields
      .map((field) => `${field}: ${before[field]} -> ${record[field]}`)
      .join(', ');
    lines.push(`changed upstream: ${record.displayName} — ${detail}`);
  }
  return lines;
}
