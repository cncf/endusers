import schedule from '@site/data/end-user-talks.json';
import { formatDate } from '../shared/formatDate';
import styles from './styles.module.css';

const verifiedDate = formatDate(schedule.generatedAt);

// Sessionize abstracts separate paragraphs with blank lines (the collector
// normalizes CRLFs and trims the text); a run of blank lines, with or without
// stray spaces on them, is one break, and a trailing break adds no paragraph.
function paragraphs(text) {
  return text.split(/\n\s*\n/).filter((part) => part !== '');
}

// The abstract and the slides and recording links a talk carries. The
// abstract is collapsed: 83 talks at several paragraphs each would bury the
// schedule, and <details> gives a keyboard-operable toggle without any
// script. The links repeat the same two labels down the page, so each names
// the talk in its accessible name while showing only the short label.
function TalkDetails({ talk }) {
  const hasLinks = Boolean(talk.slides || talk.recording);
  return (
    <>
      {talk.description && (
        <details className={styles.abstract}>
          <summary>Abstract</summary>
          {paragraphs(talk.description).map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </details>
      )}
      {hasLinks && (
        <p className={styles.links}>
          {talk.slides && (
            <a
              href={talk.slides}
              rel="noreferrer"
              aria-label={`Slides: ${talk.title}`}
            >
              Slides
            </a>
          )}
          {talk.recording && (
            <a
              href={talk.recording}
              rel="noreferrer"
              aria-label={`Recording (YouTube): ${talk.title}`}
            >
              Recording (YouTube)
            </a>
          )}
        </p>
      )}
    </>
  );
}

export default function EndUserTalkSchedule() {
  return (
    <div className={styles.schedule}>
      <p>
        {schedule.talkCount} sessions in{' '}
        <strong>End User Programming → End User Talk</strong>. All times are{' '}
        <strong>{schedule.timezone}</strong>, local to Salt Lake City. Some
        sessions overlap; talks in the same time slot run concurrently.
      </p>
      <nav className={styles.days} aria-label="End user talk days">
        {schedule.days.map((day) => (
          <a key={day.date} href={`#${day.id}`}>
            {day.label}
          </a>
        ))}
      </nav>
      <p className={styles.source}>
        Source:{' '}
        <a href={schedule.apiUrl} rel="noreferrer">
          official Sessionize API
        </a>{' '}
        · Verified {verifiedDate}. Times, rooms, and speakers may change; check
        the{' '}
        <a href={schedule.sourceUrl} rel="noreferrer">
          live official schedule
        </a>{' '}
        for updates.
      </p>
      {schedule.days.map((day) => (
        <section key={day.date} className={styles.day} aria-labelledby={day.id}>
          <h3 id={day.id} className={styles.dayHeading}>
            {day.label}
          </h3>
          {day.slots.map((slot) => (
            <div key={`${slot.start}/${slot.end}`} className={styles.slot}>
              <div className={styles.time}>
                <time dateTime={slot.start}>{slot.startLabel}</time>
                <span className={styles.endTime}>
                  – <time dateTime={slot.end}>{slot.endLabel}</time>
                </span>
                <span className={styles.timezone}>{schedule.timezone}</span>
              </div>
              <ul
                className={styles.talks}
                aria-label={`${day.label}, ${slot.startLabel}–${slot.endLabel}`}
              >
                {slot.talks.map((talk) => (
                  <li key={talk.id} className={styles.card}>
                    <div className={styles.content}>
                      <h4 className={styles.title}>
                        <a href={talk.url} rel="noreferrer">
                          {talk.title}
                        </a>
                      </h4>
                      <p className={styles.speakers}>{talk.speakers}</p>
                      <TalkDetails talk={talk} />
                    </div>
                    <div className={styles.location}>
                      <span className={styles.label}>Room</span>
                      <p>{talk.room}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
