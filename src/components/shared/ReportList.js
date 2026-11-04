import MirrorSyncStatus from './MirrorSyncStatus';
import { formatDate } from './formatDate';
import styles from './ReportList.module.css';

/**
 * The list a cncf.io report mirror renders: a provenance line, then one
 * entry per report with its title linked to cncf.io, its publication date
 * and its hand-written summary. Shared by `RadarReports` and `SurveyReports`,
 * which differ only in the data file they read and the key the report array
 * sits under, so the two /resources pages look and behave the same.
 *
 * @param {object} props
 * @param {object} props.data the mirrored data file
 * @param {string} props.listKey the property of `data` holding the reports
 * @param {string} props.ariaLabel the landmark label for the list region
 */
export default function ReportList({ data, listKey, ariaLabel }) {
  const reports = data[listKey] || [];
  return (
    <section aria-label={ariaLabel}>
      <MirrorSyncStatus
        generatedAt={data.generatedAt}
        sourceUrl={data.sourceUrl}
        label="cncf.io/reports"
        className={styles.syncStatus}
      />
      <ul className={styles.list}>
        {reports.map((report) => (
          <li key={report.id} className={styles.item}>
            <h2 className={styles.title}>
              <a href={report.url} target="_blank" rel="noreferrer">
                {report.title}
              </a>
            </h2>
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
