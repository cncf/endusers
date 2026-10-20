import peopleData from '@site/data/community-people.json';
import { formatDate } from '../shared/formatDate';
import { FreshnessNote } from '../shared/FreshnessNote';
import styles from './styles.module.css';

/**
 * Freshness signal for the TAB/staff profile lightboxes, sourced from
 * data/community-people.json's fetchedAt (set by
 * `npm run fetch:community-people`).
 */
export default function PeopleFreshness() {
  const fetchedAt = formatDate(peopleData.fetchedAt);
  if (!fetchedAt) return null;
  return FreshnessNote({
    className: styles.freshnessMargin,
    children: `Profiles last refreshed from public GitHub sources on ${fetchedAt}.`,
  });
}
