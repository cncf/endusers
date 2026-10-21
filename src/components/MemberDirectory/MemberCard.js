import { useRef, useState } from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { MemberProfile } from './MemberProfile';
import { OrgAvatar } from '../shared/OrgAvatar';
import { ProjectTagList } from '../shared/ProjectTagList';
import { formatCount, membershipLabel } from './utils';
import styles from './styles.module.css';

export function MemberCard({ member }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const logoUrl = useBaseUrl(member.logo || '');

  return (
    <article className={styles.card}>
      <div className={styles.cardBody}>
        <OrgAvatar
          logoUrl={member.logo ? logoUrl : null}
          name={member.name}
          wrapperClassName={styles.logoWrapper}
          lazy
        />
        <div className={styles.cardContent}>
          <h3 className={styles.orgName}>{member.name}</h3>
          {member.membershipStatus && (
            <p className={styles.roleLabel}>
              {membershipLabel(member.membershipStatus)}
            </p>
          )}
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
              member.awards.length === 0 && (
                <span>{membershipLabel(member.membershipStatus)}</span>
              )}
          </p>
          {member.industries.length > 0 && (
            <p className={styles.eyebrow}>
              {member.industries.slice(0, 3).join(' · ')}
            </p>
          )}
          {member.projects.length > 0 && (
            <ProjectTagList projects={member.projects} />
          )}
          <span className={styles.viewLink}>View profile →</span>
        </div>
      </div>
      {/* The trigger is stretched over the whole card and carries no visible
          text of its own, so its accessible name only has to name the
          profile it opens (WCAG 2.5.3 Label in Name). Putting the card copy
          inside the button would make all of it the visible label. */}
      <button
        ref={triggerRef}
        type="button"
        className={styles.cardButton}
        onClick={() => setOpen(true)}
        aria-label={`Open ${member.name} profile`}
      />
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
