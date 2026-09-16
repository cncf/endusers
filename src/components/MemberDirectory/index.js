import React, { useMemo, useRef, useState } from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import membersData from '@site/data/members.json';
import { useFocusTrap } from '../hooks/useFocusTrap';
import styles from './styles.module.css';

function initials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function formatCount(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function useFilterOptions(members) {
  return useMemo(() => {
    const industries = new Set();
    const projects = new Set();
    for (const member of members) {
      member.industries.forEach((i) => industries.add(i));
      member.projects.forEach((p) => projects.add(p));
    }
    return {
      industries: Array.from(industries).sort(),
      projects: Array.from(projects).sort(),
    };
  }, [members]);
}

function MemberProfile({ member, onClose, triggerRef }) {
  const { dialogRef, closeRef } = useFocusTrap({ onClose, triggerRef });
  const logoUrl = useBaseUrl(member.logo || '');

  const hasDetails =
    member.industries.length > 0 ||
    member.projects.length > 0 ||
    member.architectures.length > 0 ||
    member.awards.length > 0;

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-profile-name"
      >
        <button
          ref={closeRef}
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label={`Close ${member.name} profile`}
        >
          <span aria-hidden="true">×</span>
        </button>
        <div className={styles.profileHero}>
          <div className={styles.logoStage} aria-hidden="true">
            {member.logo ? (
              <img src={logoUrl} alt="" className={styles.profileLogo} />
            ) : (
              <span className={styles.initialsLarge}>
                {initials(member.name)}
              </span>
            )}
          </div>
          <div className={styles.profileHeading}>
            <p className={styles.profileKicker}>
              End User Community {member.role}
            </p>
            <h2 id="member-profile-name">{member.name}</h2>
            <p className={styles.profileMeta}>
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
            </p>
          </div>
        </div>
        <div className={styles.profileBody}>
          {member.industries.length > 0 && (
            <div className={styles.profileSection}>
              <h3>Industries</h3>
              <ul className={styles.tagList}>
                {member.industries.map((industry) => (
                  <li key={industry} className={styles.tag}>
                    {industry}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {member.projects.length > 0 && (
            <div className={styles.profileSection}>
              <h3>CNCF projects</h3>
              <ul className={styles.tagList}>
                {member.projects.map((project) => (
                  <li key={project} className={styles.tag}>
                    {project}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {member.architectures.length > 0 && (
            <div className={styles.profileSection}>
              <h3>Reference architectures</h3>
              <ul className={styles.linkList}>
                {member.architectures.map((architecture) => (
                  <li key={architecture.id}>
                    <Link to={`/architectures/${architecture.id}`}>
                      {architecture.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {member.awards.length > 0 && (
            <div className={styles.profileSection}>
              <h3>Awards</h3>
              <ul className={styles.awardList}>
                {member.awards.map((award, index) => (
                  <li
                    key={`${award.year}-${index}`}
                    className={styles.awardItem}
                  >
                    <p className={styles.awardLabel}>
                      {award.year} · {award.awardLabel}
                    </p>
                    <p className={styles.awardCitation}>{award.citation}</p>
                    <p className={styles.awardEvent}>{award.event}</p>
                    <div className={styles.awardLinks}>
                      {award.announcementUrl && (
                        <a
                          href={award.announcementUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Announcement<span aria-hidden="true">↗</span>
                        </a>
                      )}
                      {award.caseStudyUrl && (
                        <a
                          href={award.caseStudyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Case study<span aria-hidden="true">↗</span>
                        </a>
                      )}
                      {award.talkUrl && (
                        <a
                          href={award.talkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Watch the talk<span aria-hidden="true">↗</span>
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!hasDetails && (
            <p className={styles.bioMuted}>
              Public details for {member.name} are limited to award
              announcements. Visit the source links below to learn more.
            </p>
          )}
          <div className={styles.profileSection}>
            <h3>Sources</h3>
            <ul className={styles.linkList}>
              {member.sourceAttribution.map((url) => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {url.replace(/^https:\/\//, '').replace(/\/$/, '')}
                    <span aria-hidden="true">↗</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

function MemberCard({ member }) {
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
              member.awards.length === 0 && (
                <span>
                  End User{' '}
                  {member.role === 'contributor' ? 'contributor' : 'member'}
                </span>
              )}
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

export default function MemberDirectory() {
  const { members } = membersData;
  const { industries, projects } = useFilterOptions(members);

  const [query, setQuery] = useState('');
  const [industry, setIndustry] = useState('');
  const [project, setProject] = useState('');
  const [hasArchitecture, setHasArchitecture] = useState(false);
  const [hasAward, setHasAward] = useState(false);

  const normalizedQuery = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    return members.filter((member) => {
      if (
        normalizedQuery &&
        !member.name.toLowerCase().includes(normalizedQuery)
      ) {
        return false;
      }
      if (industry && !member.industries.includes(industry)) {
        return false;
      }
      if (project && !member.projects.includes(project)) {
        return false;
      }
      if (hasArchitecture && member.architectures.length === 0) {
        return false;
      }
      if (hasAward && member.awards.length === 0) {
        return false;
      }
      return true;
    });
  }, [members, normalizedQuery, industry, project, hasArchitecture, hasAward]);

  const clearFilters = () => {
    setQuery('');
    setIndustry('');
    setProject('');
    setHasArchitecture(false);
    setHasAward(false);
  };

  const activeFiltersCount = [
    normalizedQuery,
    industry,
    project,
    hasArchitecture,
    hasAward,
  ].filter(Boolean).length;

  return (
    <section aria-label="End User Community directory">
      <div className={styles.toolbar}>
        <div className={styles.searchRow}>
          <label htmlFor="member-search" className={styles.visuallyHidden}>
            Search members by name
          </label>
          <input
            id="member-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search members by name"
            className={styles.searchInput}
          />
        </div>
        <div className={styles.filtersRow}>
          <div className={styles.filter}>
            <label htmlFor="member-industry" className={styles.visuallyHidden}>
              Filter by industry
            </label>
            <select
              id="member-industry"
              value={industry}
              onChange={(event) => setIndustry(event.target.value)}
              className={styles.select}
            >
              <option value="">All industries</option>
              {industries.map((ind) => (
                <option key={ind} value={ind}>
                  {ind}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.filter}>
            <label htmlFor="member-project" className={styles.visuallyHidden}>
              Filter by CNCF project
            </label>
            <select
              id="member-project"
              value={project}
              onChange={(event) => setProject(event.target.value)}
              className={styles.select}
            >
              <option value="">All projects</option>
              {projects.map((proj) => (
                <option key={proj} value={proj}>
                  {proj}
                </option>
              ))}
            </select>
          </div>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={hasArchitecture}
              onChange={(event) => setHasArchitecture(event.target.checked)}
            />
            <span>Has architecture</span>
          </label>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={hasAward}
              onChange={(event) => setHasAward(event.target.checked)}
            />
            <span>Has award</span>
          </label>
        </div>
        <div className={styles.resultsBar}>
          <p aria-live="polite">
            Showing <strong>{filtered.length}</strong> of {members.length}{' '}
            members
          </p>
          {activeFiltersCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className={styles.clearButton}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <h3>No members match</h3>
          <p>
            Try clearing filters or searching for a different organization name.
          </p>
          <button
            type="button"
            onClick={clearFilters}
            className={styles.clearButton}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <ul className={styles.grid}>
          {filtered.map((member) => (
            <li key={member.id} className={styles.listItem}>
              <MemberCard member={member} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
