export function formatCount(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export { formatDate } from '../shared/formatDate';
export { initials } from '../shared/initials';

export function membershipLabel(status) {
  switch (status) {
    case 'member':
      return 'End User Member';
    case 'contributor':
      return 'End User Contributor';
    case 'member-and-contributor':
      return 'End User Member and Contributor';
    default:
      return 'Membership not specified';
  }
}

export function matchesMembership(status, filter) {
  if (!filter) return true;
  if (filter === 'member') {
    return status === 'member' || status === 'member-and-contributor';
  }
  if (filter === 'contributor') {
    return status === 'contributor' || status === 'member-and-contributor';
  }
  return status === filter;
}
