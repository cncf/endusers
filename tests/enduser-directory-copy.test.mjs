import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const repoRoot = new URL('..', import.meta.url);

function read(relativePath) {
  return readFileSync(new URL(relativePath, repoRoot), 'utf8');
}

test('the directory uses the approved End User Directory heading', () => {
  const source = read('docs/community/members.md');
  assert.match(source, /^# End User Directory$/m);
  assert.doesNotMatch(source, /^# End User Director$/m);
});

test('private community copy uses verified request/application destinations', () => {
  const community = read('docs/community/index.md');
  const practitioners = read('docs/practitioners/index.md');
  const combined = `${community}\n${practitioners}`;

  assert.match(combined, /private, application-gated spaces/);
  assert.match(combined, /https:\/\/lists\.cncf\.io\/g\/cncf-enduser\/join/);
  assert.match(
    combined,
    /https:\/\/www\.cncf\.io\/end-user-contributor-application\//,
  );
  assert.doesNotMatch(combined, /Join Slack/);
  assert.doesNotMatch(combined, /subscribe to the.*mailing list/i);
  assert.doesNotMatch(combined, /Request[^.]*https:\/\/slack\.cncf\.io\//i);
});
