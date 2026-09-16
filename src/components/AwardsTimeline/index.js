import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import awardsData from '@site/data/awards.json';
import styles from './styles.module.css';

function WinnerCard({ entry }) {
  const {
    organization,
    awardLabel,
    citation,
    event,
    logo,
    announcementUrl,
    caseStudyUrl,
    talkUrl,
  } = entry;
  const primaryUrl = announcementUrl || talkUrl;
  const logoUrl = useBaseUrl(logo || '');
  return (
    <article className={styles.card}>
      <a
        className={styles.logoStage}
        href={primaryUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${organization} — ${awardLabel}`}
      >
        {logo ? (
          <img
            src={logoUrl}
            alt={`${organization} logo`}
            className={styles.logo}
            loading="lazy"
          />
        ) : (
          <span className={styles.logoFallback}>{organization}</span>
        )}
      </a>
      <div className={styles.cardBody}>
        <p className={styles.awardLabel}>{awardLabel}</p>
        <h3 className={styles.orgName}>{organization}</h3>
        <p className={styles.citation}>{citation}</p>
        <p className={styles.event}>{event}</p>
        <div className={styles.links}>
          {announcementUrl && (
            <a href={announcementUrl} target="_blank" rel="noopener noreferrer">
              Announcement
            </a>
          )}
          {caseStudyUrl && (
            <a href={caseStudyUrl} target="_blank" rel="noopener noreferrer">
              Case study
            </a>
          )}
          {talkUrl && (
            <a href={talkUrl} target="_blank" rel="noopener noreferrer">
              Watch the talk
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export default function AwardsTimeline() {
  const byYear = new Map();
  for (const entry of awardsData.awards) {
    if (!byYear.has(entry.year)) byYear.set(entry.year, []);
    byYear.get(entry.year).push(entry);
  }
  const years = Array.from(byYear.keys()).sort((a, b) => b - a);
  const verifiedDate = awardsData.verifiedAt
    ? new Date(awardsData.verifiedAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <div className={styles.timeline}>
      {verifiedDate && awardsData.verifiedAgainst && (
        <p className={styles.verification}>
          Winner history audited for completeness against{' '}
          <a href={awardsData.verifiedAgainst} target="_blank" rel="noreferrer">
            contribute.cncf.io/community/awards
          </a>{' '}
          on {verifiedDate}.
        </p>
      )}
      {years.map((year) => (
        <section key={year} className={styles.yearGroup}>
          <div className={styles.yearRail}>
            <span className={styles.yearBadge}>{year}</span>
            <span className={styles.railLine} aria-hidden="true" />
          </div>
          <div className={styles.yearEntries}>
            {byYear.get(year).map((entry, i) => (
              <WinnerCard key={`${entry.slug}-${i}`} entry={entry} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
