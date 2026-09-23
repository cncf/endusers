import React from 'react';
import peopleData from '@site/data/community-people.json';
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
 * Freshness signal for the TAB/staff profile lightboxes, sourced from
 * data/community-people.json's fetchedAt (set by
 * `npm run fetch:community-people`).
 */
export default function PeopleFreshness() {
  const fetchedAt = formatDate(peopleData.fetchedAt);
  if (!fetchedAt) return null;
  return (
    <p className={styles.freshnessNote}>
      Profiles last refreshed from public GitHub sources on {fetchedAt}.
    </p>
  );
}
