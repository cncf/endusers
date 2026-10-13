import React from 'react';
import schedule from '@site/data/end-user-talks.json';
import styles from './styles.module.css';

const verifiedDate = new Date(schedule.generatedAt).toLocaleDateString(
  'en-US',
  {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  },
);

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
          <h5 id={day.id} className={styles.dayHeading}>
            {day.label}
          </h5>
          {day.slots.map((slot) => (
            <div key={`${slot.start}/${slot.end}`} className={styles.slot}>
              <div className={styles.time}>
                <time dateTime={slot.start}>{slot.startLabel}</time>
                <span className={styles.endTime}>
                  – <time dateTime={slot.end}>{slot.endLabel}</time>
                </span>
                <span className={styles.timezone}>MST</span>
              </div>
              <ul
                className={styles.talks}
                aria-label={`${day.label}, ${slot.startLabel}–${slot.endLabel}`}
              >
                {slot.talks.map((talk) => (
                  <li key={talk.id} className={styles.card}>
                    <div className={styles.content}>
                      <h6 className={styles.title}>
                        <a href={talk.url} rel="noreferrer">
                          {talk.title}
                        </a>
                      </h6>
                      <p className={styles.speakers}>{talk.speakers}</p>
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
