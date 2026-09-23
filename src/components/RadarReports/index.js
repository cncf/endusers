import React from 'react';
import data from '@site/data/radar-reports.json';
import styles from './styles.module.css';

function SyncStatus() {
  if (!data.generatedAt) return null;
  const syncDate = new Date(data.generatedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return (
    <p className={styles.syncStatus}>
      Mirrored from{' '}
      <a href={data.sourceUrl} target="_blank" rel="noreferrer">
        cncf.io/reports
      </a>{' '}
      on {syncDate}.
    </p>
  );
}

export default function RadarReports() {
  const radarReports = data.radarReports || [];
  return (
    <section aria-label="CNCF Technology Radar reports">
      <SyncStatus />
      <ul className={styles.list}>
        {radarReports.map((report) => (
          <li key={report.id} className={styles.item}>
            <h3 className={styles.title}>
              <a href={report.url} target="_blank" rel="noreferrer">
                {report.title}
              </a>
            </h3>
            {report.publishedAt && (
              <p className={styles.date}>
                {new Date(report.publishedAt).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            )}
            <p className={styles.summary}>{report.summary}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
