/**
 * Comparator for the filter option lists on the case-study,
 * reference-architecture and member catalogs. Project and industry names are
 * published in their own casing (`etcd`, `cert-manager`, `gaming`), and the
 * default `.sort()` orders by code point, which lists every lowercase label
 * after every capitalised one. Locale collation orders letters before case,
 * and pinning the locale keeps the order the same on every runtime.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareLabels(a, b) {
  return a.localeCompare(b, 'en');
}
