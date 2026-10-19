/**
 * Two-letter monogram for an organization or person name, used as the
 * fallback where a logo or avatar is missing (`MemberDirectory`,
 * `ReferenceArchitectures`).
 *
 * @param {string} name
 * @returns {string}
 */
export function initials(name) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}
