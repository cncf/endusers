import React from 'react';
import projects from '@site/data/projects-born.json';
import styles from './styles.module.css';

export default function ProjectsBorn({
  compact = false,
  title = 'Projects born at end-user organizations',
  intro = 'Some of the most widely adopted CNCF projects started as internal tools built to solve real production problems. The End User Community helps teams share those breakthroughs with the ecosystem.',
}) {
  const titleId = compact
    ? 'projects-born-title-footer'
    : 'projects-born-title-section';

  return (
    <section
      className={compact ? styles.compact : styles.section}
      aria-labelledby={titleId}
    >
      <div className={styles.heading}>
        {!compact && (
          <p className={styles.kicker}>Production becomes open source</p>
        )}
        <h2 id={titleId}>{title}</h2>
        {!compact && <p>{intro}</p>}
      </div>
      <div className={styles.projects}>
        {projects.map((project) => (
          <a key={project.name} className={styles.project} href={project.url}>
            <span className={styles.projectName}>{project.name}</span>
            <span className={styles.projectOrigin}>
              Born at {project.origin}
            </span>
            {!compact && (
              <span className={styles.projectDescription}>
                {project.description}
              </span>
            )}
            <span className={styles.projectLink}>
              Visit project <span aria-hidden="true">↗</span>
            </span>
          </a>
        ))}
      </div>
      {!compact && (
        <p className={styles.footerNote}>
          Running something your peers would benefit from?{' '}
          <a href="https://github.com/cncf/tab">Talk to the End User TAB</a>{' '}
          about sharing projects and architectures.
        </p>
      )}
    </section>
  );
}
