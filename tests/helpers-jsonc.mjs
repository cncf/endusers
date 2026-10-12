// Strips // and /* */ comments without touching sequences inside strings, so
// a URL such as "https://example.com" survives. devcontainer.json is JSON
// with Comments: JSON.parse rejects it, and the repo has no jsonc dependency.
//
// Extracted from tests/dev-environment.test.mjs so the parser itself can be
// exercised: the two files it is pointed at in that contract
// (.devcontainer/devcontainer.json, .vscode/settings.json) carry one line
// comment between them and no block comment or backslash escape at all, so
// running the contract never enters the block-comment or string-escape arms.
// tests/jsonc-comment-stripper.test.mjs pins them.
export function stripJsonComments(source) {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (inLine) {
      if (char === '\n') {
        inLine = false;
        out += char;
      }
      continue;
    }
    if (inBlock) {
      if (char === '*' && next === '/') {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += char;
      if (char === '\\') {
        out += source[i + 1] ?? '';
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === '/' && next === '/') {
      inLine = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlock = true;
      i += 1;
      continue;
    }
    out += char;
  }
  return out;
}
