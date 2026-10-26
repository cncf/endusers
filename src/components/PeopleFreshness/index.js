import peopleData from '@site/data/community-people.json';
import { formatDate } from '../shared/formatDate';
import styles from './styles.module.css';

/**
 * Freshness signal for the TAB/staff profile lightboxes, sourced from
 * data/community-people.json's fetchedAt. The collector rewrites the file
 * only when a profile changes (ADR 0009), so the date is when the published
 * profiles last changed, not when the weekly refresh last ran.
 */
export default function PeopleFreshness() {
  const fetchedAt = formatDate(peopleData.fetchedAt);
  if (!fetchedAt) return null;
  return (
    <p className={styles.freshnessNote}>
      Profiles last updated from public GitHub sources on {fetchedAt}.
    </p>
  );
}
