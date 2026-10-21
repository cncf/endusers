import groupsData from '@site/data/community-groups.json';
import { formatDate } from '../shared/formatDate';
import styles from './styles.module.css';

/**
 * Last-updated + drift signal for the End User Group cards, sourced from
 * data/community-groups.json (set by `npm run check:community-group-links`).
 * Surfaces any group whose upstream repository is archived or unreachable so
 * that drift is visible on the page, not just in a CI log.
 */
export default function GroupLinkStatus() {
  const generatedAt = formatDate(groupsData?.generatedAt);
  const stale = (groupsData?.groups || []).filter(
    (group) => group.archived || group.reachable === false,
  );
  return (
    <div className={styles.freshnessNote}>
      {generatedAt && (
        <p>Upstream group status last updated on {generatedAt}.</p>
      )}
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
