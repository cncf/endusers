import membersData from '@site/data/members.json';
import { useFilterOptions } from './hooks';
import { matchesMembership } from './utils';
import { MemberCard } from './MemberCard';
import { DirectoryFreshness } from './DirectoryFreshness';
import { useFilterToolbar } from '../shared/useFilterToolbar';
import FilterToolbar from '../shared/FilterToolbar';
import EmptyFilterState from '../shared/EmptyFilterState';
import styles from './styles.module.css';

const DEFAULT_FILTERS = {
  query: '',
  industry: '',
  project: '',
  membership: '',
  hasArchitecture: false,
  hasAward: false,
};

function filterMembers(members, filters) {
  const { query, industry, project, membership, hasArchitecture, hasAward } =
    filters;
  const normalizedQuery = query.trim().toLowerCase();
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
    if (!matchesMembership(member.membershipStatus, membership)) {
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
}

export default function MemberDirectory() {
  const { members } = membersData;
  const { industries, projects, membershipStatuses } =
    useFilterOptions(members);

  const { filters, setFilter, filtered, clearFilters, activeCount } =
    useFilterToolbar(members, DEFAULT_FILTERS, filterMembers);
  const { query, industry, project, membership, hasArchitecture, hasAward } =
    filters;
  const activeFiltersCount = activeCount;

  return (
    <section aria-label="End User Community organization directory">
      <DirectoryFreshness />
      <FilterToolbar
        searchId="member-search"
        searchLabel="Search organizations by name"
        searchValue={query}
        searchPlaceholder="Search organizations by name"
        onSearchChange={(value) => setFilter('query', value)}
        selects={[
          {
            id: 'member-industry',
            label: 'Filter by industry',
            value: industry,
            onChange: (value) => setFilter('industry', value),
            options: industries,
            allLabel: 'All industries',
          },
          {
            id: 'member-membership',
            label: 'Filter by membership status',
            value: membership,
            onChange: (value) => setFilter('membership', value),
            options: membershipStatuses,
            allLabel: 'All organizations',
          },
          {
            id: 'member-project',
            label: 'Filter by CNCF project',
            value: project,
            onChange: (value) => setFilter('project', value),
            options: projects,
            allLabel: 'All projects',
          },
        ]}
        extra={[
          <label className={styles.toggle} key="hasArchitecture">
            <input
              type="checkbox"
              checked={hasArchitecture}
              onChange={(event) =>
                setFilter('hasArchitecture', event.target.checked)
              }
            />
            <span>Has architecture</span>
          </label>,
          <label className={styles.toggle} key="hasAward">
            <input
              type="checkbox"
              checked={hasAward}
              onChange={(event) => setFilter('hasAward', event.target.checked)}
            />
            <span>Has award</span>
          </label>,
        ]}
        resultCount={filtered.length}
        totalCount={members.length}
        resultNoun="organizations"
        activeCount={activeFiltersCount}
        onClear={clearFilters}
      />

      {filtered.length === 0 ? (
        <EmptyFilterState
          heading="No organizations match"
          onClear={clearFilters}
        >
          Try clearing filters or searching for a different organization name.
        </EmptyFilterState>
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
