import { useMemo, useState } from 'react';
import { useFilterToolbar } from '../shared/useFilterToolbar';
import FilterToolbar from '../shared/FilterToolbar';

const DEFAULT_FILTERS = {
  query: '',
  industry: '',
  project: '',
  organization: '',
  tags: [],
};

// Upstream tags are not consistently spelled ("Kubernetes" and "kubernetes",
// "public cloud" and "public-cloud"), so tags are compared ignoring case and
// separators and listed once.
function tagKey(tag) {
  // Stryker disable next-line MethodExpression: upper-casing is an equally valid case-insensitive key
  return tag.toLowerCase().replace(/[-_\s]+/g, ' ');
}

export const SORT_OPTIONS = [
  { value: 'alphabetical', label: 'Sort: Alphabetical' },
  { value: 'updated', label: 'Sort: Recently updated' },
];

const DEFAULT_SORT = SORT_OPTIONS[0].value;

function compareAlphabetical(a, b) {
  return (
    a.organization.localeCompare(b.organization) ||
    a.title.localeCompare(b.title)
  );
}

// `updated` is a YYYY-MM-DD string, so comparing it as text orders it by date.
function compareRecentlyUpdated(a, b) {
  return b.updated.localeCompare(a.updated) || compareAlphabetical(a, b);
}

export function sortArchitectures(architectures, sort) {
  const compare =
    sort === 'updated' ? compareRecentlyUpdated : compareAlphabetical;
  return Array.from(architectures).sort(compare);
}

export function useArchitectureFilterOptions(architectures) {
  return useMemo(() => {
    const industries = new Set();
    const projects = new Set();
    const organizations = new Set();
    const tags = new Map();
    for (const architecture of architectures) {
      organizations.add(architecture.organization);
      architecture.industries.forEach((i) => industries.add(i));
      architecture.projects.forEach((p) => projects.add(p));
      architecture.tags.forEach((tag) => {
        if (!tags.has(tagKey(tag))) tags.set(tagKey(tag), tag);
      });
    }
    return {
      industries: Array.from(industries).sort(),
      projects: Array.from(projects).sort(),
      organizations: Array.from(organizations).sort(),
      tags: Array.from(tags.values()).sort((a, b) =>
        tagKey(a).localeCompare(tagKey(b)),
      ),
    };
  }, [architectures]);
}

export function filterArchitectures(architectures, filters) {
  const { query, industry, project, organization, tags } = filters;
  const normalizedQuery = query.trim().toLowerCase();
  const tagQuery = tagKey(normalizedQuery);
  const wantedTags = new Set(tags.map(tagKey));
  return architectures.filter((architecture) => {
    // Stryker disable next-line ConditionalExpression: an empty query matches every architecture
    if (normalizedQuery) {
      const searchable =
        `${architecture.organization} ${architecture.title} ${architecture.summary}`.toLowerCase();
      const tagText = architecture.tags.map(tagKey).join(' ');
      if (
        !searchable.includes(normalizedQuery) &&
        !tagText.includes(tagQuery)
      ) {
        return false;
      }
    }
    if (industry && !architecture.industries.includes(industry)) {
      return false;
    }
    if (project && !architecture.projects.includes(project)) {
      return false;
    }
    if (organization && architecture.organization !== organization) {
      return false;
    }
    // Selected tags widen within themselves: any one of them is a match.
    if (
      wantedTags.size > 0 &&
      !architecture.tags.some((tag) => wantedTags.has(tagKey(tag)))
    ) {
      return false;
    }
    return true;
  });
}

export function useArchitectureFilters(architectures) {
  const options = useArchitectureFilterOptions(architectures);
  const { filters, setFilter, filtered, clearFilters, activeCount } =
    useFilterToolbar(architectures, DEFAULT_FILTERS, filterArchitectures);
  // Sort order is kept apart from the filters: it never narrows the results,
  // so it does not count as an active filter and Clear filters leaves it.
  const [sort, setSort] = useState(DEFAULT_SORT);
  const sorted = useMemo(
    () => sortArchitectures(filtered, sort),
    [filtered, sort],
  );

  return {
    options,
    filters,
    setQuery: (value) => setFilter('query', value),
    setIndustry: (value) => setFilter('industry', value),
    setProject: (value) => setFilter('project', value),
    setOrganization: (value) => setFilter('organization', value),
    // The tag select lists only unselected tags, so a tag is never added twice.
    addTag: (tag) => setFilter('tags', [...filters.tags, tag]),
    removeTag: (tag) =>
      setFilter(
        'tags',
        filters.tags.filter((t) => t !== tag),
      ),
    sort,
    setSort,
    filtered: sorted,
    clearFilters,
    activeCount,
  };
}

export default function ArchitectureFilters({
  options,
  filters,
  setQuery,
  setIndustry,
  setProject,
  setOrganization,
  addTag,
  removeTag,
  sort,
  setSort,
  activeCount,
  onClear,
  resultCount,
  totalCount,
}) {
  const selectedTags = new Set(filters.tags.map(tagKey));
  return (
    <FilterToolbar
      searchId="architecture-search"
      searchLabel="Search architectures by organization, title, or tag"
      searchValue={filters.query}
      searchPlaceholder="Search by organization, title, or tag"
      onSearchChange={setQuery}
      searchChips={{
        values: filters.tags,
        listLabel: 'Selected tags',
        removeLabel: (tag) => `Remove tag ${tag}`,
        onRemove: removeTag,
      }}
      selects={[
        {
          id: 'architecture-organization',
          label: 'Filter by organization',
          value: filters.organization,
          onChange: setOrganization,
          options: options.organizations,
          allLabel: 'All organizations',
        },
        {
          id: 'architecture-industry',
          label: 'Filter by industry',
          value: filters.industry,
          onChange: setIndustry,
          options: options.industries,
          allLabel: 'All industries',
        },
        {
          id: 'architecture-project',
          label: 'Filter by CNCF project',
          value: filters.project,
          onChange: setProject,
          options: options.projects,
          allLabel: 'All projects',
        },
        {
          id: 'architecture-tag',
          label: 'Add a tag to the search',
          value: '',
          onChange: addTag,
          options: options.tags.filter((tag) => !selectedTags.has(tagKey(tag))),
          allLabel: 'Add a tag',
        },
        {
          id: 'architecture-sort',
          label: 'Sort architectures',
          value: sort,
          onChange: setSort,
          options: SORT_OPTIONS,
        },
      ]}
      resultCount={resultCount}
      totalCount={totalCount}
      resultNoun="architectures"
      activeCount={activeCount}
      onClear={onClear}
    />
  );
}
