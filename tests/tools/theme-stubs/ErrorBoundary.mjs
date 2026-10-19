// Test stub for `@theme/ErrorBoundary` (docusaurus-plugin-search-local).
//
// The real class swallows a render error from the search bar so it cannot
// take the navbar down with it. Unit tests only assert the wrapper is in
// place around SearchBar, so the stub passes its children through.

export default function ErrorBoundary({ children }) {
  return children;
}
