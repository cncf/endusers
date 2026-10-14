import React from 'react';
import data from '@site/data/radar-reports.json';
import MirrorSyncStatus from '../shared/MirrorSyncStatus';
import { formatDate } from '../shared/formatDate';
import styles from './styles.module.css';

export default function RadarReports() {
  const radarReports = data.radarReports || [];
  return (
    <section aria-label="CNCF Technology Radar reports">
      <MirrorSyncStatus
        generatedAt={data.generatedAt}
        sourceUrl={data.sourceUrl}
        label="cncf.io/reports"
        className={styles.syncStatus}
      />
      <ul className={styles.list}>
        {radarReports.map((report) => (
          <li key={report.id} className={styles.item}>
            <h3 className={styles.title}>
              <a href={report.url} target="_blank" rel="noreferrer">
                {report.title}
              </a>
            </h3>
            {report.publishedAt && (
              <p className={styles.date}>{formatDate(report.publishedAt)}</p>
            )}
            <p className={styles.summary}>{report.summary}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
