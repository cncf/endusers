// Test stub for `@docusaurus/router`.
//
// The only import src/ makes from it is useLocation, which the swizzled
// SearchBar reads for the query string that carries search-term highlight
// parameters. Unit tests run without a router, so this stub hands out a
// location whose `search` a test sets through setLocationSearch before
// rendering.

let search = '';

export function useLocation() {
  return { search };
}

export function setLocationSearch(next) {
  search = next;
}
