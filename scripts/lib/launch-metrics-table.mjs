// Shared table-generation logic used by both
// scripts/sync-launch-metrics-table.mjs (writes ROADMAP.md) and
// scripts/validate-launch-metrics.mjs (checks ROADMAP.md hasn't drifted
// from data/launch-metrics.json without being re-synced).
export const START = '<!-- LAUNCH-METRICS-TABLE:START -->';
export const END = '<!-- LAUNCH-METRICS-TABLE:END -->';

export function buildTable(data) {
  const checkpointLabel = data.checkpointLabel || 'baseline';
  const checkpointAt = data.preLaunchCheckpointAt || data.baselineSnapshotAt;
  const header = `| Signal | Baseline (${checkpointLabel}, ${checkpointAt}) | 90-day post-launch target |`;
  const divider = '| --- | --- | --- |';
  const rows = (data.signals || []).map(
    (s) => `| ${s.label} | ${s.baseline} | ${s.target90Day} |`,
  );
  return [header, divider, ...rows].join('\n');
}

// Prettier re-pads table column widths for readability, so a byte-for-byte
// comparison between the generated table and what's committed would false-
// positive on drift after every `npx prettier --write`. Normalize by
// collapsing whitespace within each cell before comparing.
export function normalizeTable(markdown) {
  return markdown
    .split('\n')
    .filter((line) => !/^\|[\s-]*\|[\s-:]*\|[\s-:]*\|$/.test(line.trim()))
    .map((line) =>
      line
        .split('|')
        .map((cell) => cell.trim())
        .join('|'),
    )
    .join('\n');
}
