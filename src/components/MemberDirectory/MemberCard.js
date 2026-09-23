import React, { useRef, useState } from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { MemberProfile } from './MemberProfile';
import { initials, formatCount } from './utils';
import styles from './styles.module.css';

export function MemberCard({ member }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const logoUrl = useBaseUrl(member.logo || '');

  return (
    <article className={styles.card}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.cardButton}
        onClick={() => setOpen(true)}
        aria-label={`Open ${member.name} profile`}
      >
        <div className={styles.logoWrapper} aria-hidden="true">
          {member.logo ? (
            <img src={logoUrl} alt="" className={styles.logo} loading="lazy" />
          ) : (
            <span className={styles.initials}>{initials(member.name)}</span>
          )}
        </div>
        <div className={styles.cardContent}>
          <h3 className={styles.orgName}>{member.name}</h3>
          <p className={styles.cardMeta}>
            {member.architectures.length > 0 && (
              <span>
                {formatCount(
                  member.architectures.length,
                  'architecture',
                  'architectures',
                )}
              </span>
            )}
            {member.awards.length > 0 && (
              <span>
                {formatCount(member.awards.length, 'award', 'awards')}
              </span>
            )}
            {member.architectures.length === 0 &&
              member.awards.length === 0 && <span>Community member</span>}
          </p>
          {member.industries.length > 0 && (
            <p className={styles.eyebrow}>
              {member.industries.slice(0, 3).join(' · ')}
            </p>
          )}
          {member.projects.length > 0 && (
            <div className={styles.projectsList}>
              {member.projects.slice(0, 4).map((project) => (
                <span key={project} className={styles.projectTag}>
                  {project}
                </span>
              ))}
            </div>
          )}
          <span className={styles.viewLink}>View profile →</span>
        </div>
      </button>
      {open && (
        <MemberProfile
          member={member}
          onClose={() => setOpen(false)}
          triggerRef={triggerRef}
        />
      )}
    </article>
  );
}
