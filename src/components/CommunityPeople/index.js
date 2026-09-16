import React, { useRef, useState } from 'react';
import peopleData from '@site/data/community-people.json';
import { useFocusTrap } from '../hooks/useFocusTrap';
import styles from './styles.module.css';

function profileUrl(value, type) {
  if (!value) return null;
  if (type === 'github') return `https://github.com/${value}`;
  if (type === 'linkedin') return `https://www.linkedin.com/in/${value}`;
  return `https://twitter.com/${value}`;
}

function PersonDialog({ person, onClose, triggerRef }) {
  const { dialogRef, closeRef } = useFocusTrap({ onClose, triggerRef });
  const { name, company, role, image, bio, location, blog, github, linkedin, twitter, publicRepos, followers } = person;

  const links = [
    ['GitHub', profileUrl(github, 'github')],
    ['LinkedIn', profileUrl(linkedin, 'linkedin')],
    ['Twitter', profileUrl(twitter, 'twitter')],
    ['Website', blog ? (blog.startsWith('http') ? blog : `https://${blog}`) : null]
  ].filter(([, href]) => href);

  return (
    <div className={styles.backdrop} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="profile-name">
        <button ref={closeRef} type="button" className={styles.closeButton} onClick={onClose} aria-label={`Close ${name} profile`}>
          <span aria-hidden="true">×</span>
        </button>
        <div className={styles.profileHero}>
          <img src={image} alt="" className={styles.profileImage} width="240" height="240" />
          <div className={styles.profileHeading}>
            <p className={styles.profileKicker}>CNCF end-user community</p>
            <h3 id="profile-name">{name}</h3>
            <p className={styles.profileRole}>{role || 'Community member'}{role && company ? ` · ${company}` : company}</p>
            {location && <p className={styles.location}>{location}</p>}
          </div>
        </div>
        <div className={styles.profileBody}>
          {bio ? <p className={styles.bio}>{bio}</p> : <p className={styles.bioMuted}>Public profile details are limited. Use the links below to learn more about {name}.</p>}
          <div className={styles.stats} aria-label={`${name} public GitHub activity`}>
            {github && <div><strong>{publicRepos}</strong><span>public repos</span></div>}
            {github && <div><strong>{followers}</strong><span>followers</span></div>}
          </div>
          <div className={styles.profileLinks}>
            {links.map(([label, href]) => <a key={label} href={href} target="_blank" rel="noreferrer">{label}<span aria-hidden="true">↗</span></a>)}
          </div>
          <p className={styles.sourceNote}>Profile details refreshed from public sources at build time.</p>
        </div>
      </section>
    </div>
  );
}

function PersonCard({ person }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const { name, company, role, image } = person;
  return (
    <article className={styles.personCard}>
      <button ref={triggerRef} type="button" className={styles.imageButton} onClick={() => setOpen(true)} aria-label={`Open ${name} profile`}>
        <img src={image} alt={`${name}, ${role || company}`} className={styles.personImage} width="320" height="320" loading="lazy" />
        <span className={styles.viewLabel}>View profile</span>
      </button>
      <div className={styles.personInfo}>
        <h4>{name}</h4>
        <p>{role || company}</p>
        {role && <span>{company}</span>}
      </div>
      {open && <PersonDialog person={person} onClose={() => setOpen(false)} triggerRef={triggerRef} />}
    </article>
  );
}

export default function CommunityPeople({ section }) {
  const people = peopleData.people[section] || [];
  return <div className={styles.peopleGrid}>{people.map((person) => <PersonCard key={person.name} person={person} />)}</div>;
}
