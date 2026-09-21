// Test stub for `@docusaurus/useBaseUrl`.
//
// The real hook prefixes a site-relative path with the configured `baseUrl`.
// Unit tests run without a Docusaurus context, so this stub reproduces the
// behaviour for the default `baseUrl` of '/': absolute URLs and protocol
// relative URLs are returned untouched, everything else is normalised to a
// single leading slash. That is enough to assert which path a component asked
// for without pulling in the Docusaurus runtime.

export default function useBaseUrl(url) {
  if (typeof url !== 'string' || url === '') return url;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) return url;
  return url.startsWith('/') ? url : `/${url}`;
}
