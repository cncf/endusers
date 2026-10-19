// Test stub for `@docusaurus/ExecutionEnvironment`.
//
// The real module reports whether the code is running in a browser, which
// the swizzled SearchBar checks before reading the query string. Unit tests
// exercise both sides, so the flag is a mutable property — a test that flips
// it must set it back to true afterwards.

const ExecutionEnvironment = { canUseDOM: true };

export default ExecutionEnvironment;
