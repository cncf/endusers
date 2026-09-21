export function initials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function formatCount(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}
