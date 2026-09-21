import React from 'react';
import groupsData from '@site/data/community-groups.json';
import styles from './styles.module.css';

function formatDate(isoDate) {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Freshness + drift signal for the End User Group cards, sourced from
 * data/community-groups.json (set by `npm run check:community-group-links`).
 * Surfaces any group whose upstream repository is archived or unreachable so
 * that drift is visible on the page, not just in a CI log.
 */
export default function GroupLinkStatus() {
  const checkedAt = formatDate(groupsData?.checkedAt);
  const stale = (groupsData?.groups || []).filter(
    (group) => group.archived || group.reachable === false,
  );
  return (
    <div className={styles.freshnessNote}>
      {checkedAt && <p>Upstream group links last verified on {checkedAt}.</p>}
      {stale.length > 0 && (
        <p className={styles.warning}>
          {stale.map((group) => group.name).join(', ')}{' '}
          {stale.length === 1 ? 'has an' : 'have'} archived or unreachable
          upstream {stale.length === 1 ? 'repository' : 'repositories'} — verify
          the group is still active before relying on its link.
        </p>
      )}
    </div>
  );
}
