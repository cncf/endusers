import Link from '@docusaurus/Link';
import { usePluginData } from '@docusaurus/useGlobalData';
import { formatDateRange } from '../shared/formatDate';
import styles from './styles.module.css';

const PLUGIN_NAME = 'events-catalog';

const UTC_MONTH_SHORT = { timeZone: 'UTC', month: 'short' };

// The calendar block beside each row: the start month and the day span.
// Dates are ISO calendar dates, which parse as UTC midnight; formatting is
// pinned to UTC for the same reason formatDate() is.
function dayLabel(event) {
  const from = new Date(event.start);
  const to = new Date(event.end);
  const month = from.toLocaleDateString('en-US', UTC_MONTH_SHORT);
  const days =
    from.getTime() === to.getTime() ||
    from.getUTCMonth() !== to.getUTCMonth() ||
    from.getUTCFullYear() !== to.getUTCFullYear()
      ? String(from.getUTCDate())
      : `${from.getUTCDate()}–${to.getUTCDate()}`;
  return { month, days };
}

function EventRow({ event }) {
  const { month, days } = dayLabel(event);
  return (
    <li className={styles.row}>
      <div className={styles.calendar} aria-hidden="true">
        <span className={styles.month}>{month}</span>
        <span className={styles.days}>{days}</span>
      </div>
      <div className={styles.details}>
        <h3 className={styles.title}>
          <Link to={event.route}>{event.title}</Link>
        </h3>
        <p className={styles.meta}>
          <time dateTime={event.start}>
            {formatDateRange(event.start, event.end)}
          </time>
          <span className={styles.separator} aria-hidden="true">
            ·
          </span>
          <span>{event.location}</span>
        </p>
        <p className={styles.description}>{event.description}</p>
      </div>
    </li>
  );
}

/**
 * The newest year's events, latest first, from the events-catalog plugin's
 * global data. Earlier years are reachable from the sidebar; the trailing
 * line links to each one's newest event so a reader on a narrow screen,
 * where the sidebar is behind the menu button, still has a path to them.
 */
export default function EventsIndex() {
  const { years } = usePluginData(PLUGIN_NAME);
  if (years.length === 0) {
    return <p className={styles.empty}>No events have been announced yet.</p>;
  }
  const [current, ...earlier] = years;
  return (
    <section className={styles.index} aria-labelledby="events-current-year">
      <h2 id="events-current-year">{current.year}</h2>
      <ol className={styles.list}>
        {current.events.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </ol>
      {earlier.length > 0 && (
        <p className={styles.earlier}>
          Earlier years:{' '}
          {earlier.map((group, index) => (
            <span key={group.year}>
              {index > 0 && ', '}
              <Link to={group.events[0].route}>{group.year}</Link>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
