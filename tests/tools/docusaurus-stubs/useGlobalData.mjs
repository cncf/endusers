// Test stub for `@docusaurus/useGlobalData`.
//
// The real `usePluginData(name)` reads the global data a plugin published
// with `setGlobalData` during the build. Unit tests run without a Docusaurus
// context, so a test seeds the data it wants a component to see with
// setPluginData() and the component reads it back through the same named
// export the runtime offers. An unseeded plugin name throws, as the runtime
// does, so a component asking for data nothing published fails loudly.

const store = new Map();

/**
 * @param {string} pluginName
 * @param {unknown} data
 * @returns {() => void} restores the previous value
 */
export function setPluginData(pluginName, data) {
  const had = store.has(pluginName);
  const previous = store.get(pluginName);
  store.set(pluginName, data);
  return () => {
    if (had) store.set(pluginName, previous);
    else store.delete(pluginName);
  };
}

export function usePluginData(pluginName) {
  if (!store.has(pluginName)) {
    throw new Error(
      `Docusaurus plugin global data not found for "${pluginName}" plugin.`,
    );
  }
  return store.get(pluginName);
}
