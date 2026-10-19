// Test stub for `@docusaurus/useGlobalData`.
//
// The real usePluginData(pluginName) reads the data a plugin published
// during the build. The only consumer under src/ is the swizzled SearchBar,
// which reads `highlightSearchTermsOnTargetPage` off
// docusaurus-plugin-search-local, so this stub hands out a mutable options
// object a test sets through setPluginData before rendering.

let data = {};

export function usePluginData() {
  return data;
}

export function setPluginData(next) {
  data = next;
}
