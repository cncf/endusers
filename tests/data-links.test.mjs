// The weekly link gate resolves markdown only, so an outbound URL that
// reaches a page from data/members.json instead of from prose is never
// checked and can rot unnoticed. These tests pin the collection rules and
// the alive/dead decision the data-driven half of that gate rests on.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEAD_STATUS_CODES,
  UNRESOLVED_ERROR_CODES,
  classifyProbe,
  collectRenderedMemberLinks,
  formatFinding,
  resolveVerdicts,
} from '../scripts/lib/data-links.mjs';

test('collects every sourceAttribution entry a member profile renders', () => {
  const links = collectRenderedMemberLinks({
    members: [
      {
        name: 'Acme',
        sourceAttribution: ['https://example.com/a', 'https://example.com/b'],
      },
    ],
  });
  assert.deepEqual(
    [...links.keys()],
    ['https://example.com/a', 'https://example.com/b'],
  );
  assert.deepEqual(links.get('https://example.com/a'), [
    'Acme sourceAttribution',
  ]);
});

test('collects the three award links rendered beside a member profile', () => {
  const links = collectRenderedMemberLinks({
    members: [
      {
        name: 'Acme',
        awards: [
          {
            announcementUrl: 'https://example.com/announce',
            caseStudyUrl: 'https://example.com/case',
            talkUrl: 'https://example.com/talk',
          },
        ],
      },
    ],
  });
  assert.deepEqual(
    [...links.keys()],
    [
      'https://example.com/announce',
      'https://example.com/case',
      'https://example.com/talk',
    ],
  );
  // The citation names which of the three anchors rotted, so a maintainer
  // reading the report knows where to look without opening the data file.
  assert.deepEqual(links.get('https://example.com/announce'), [
    'Acme award announcement',
  ]);
  assert.deepEqual(links.get('https://example.com/case'), [
    'Acme award case study',
  ]);
  assert.deepEqual(links.get('https://example.com/talk'), ['Acme award talk']);
});

test('a plain http member link is collected alongside https', () => {
  // MemberProfile renders whatever scheme the data carries, and an http
  // homepage rots the same way, so the gate must not be https-only.
  const links = collectRenderedMemberLinks({
    members: [{ name: 'Acme', sourceAttribution: ['http://example.com/a'] }],
  });
  assert.deepEqual([...links.keys()], ['http://example.com/a']);
});

test('a scheme that only appears mid-string is not a link', () => {
  // A stray leading space, or a relative path that happens to contain the
  // scheme, is not something a browser resolves as an absolute URL; probing
  // it would report rot against a host the site never requests.
  const links = collectRenderedMemberLinks({
    members: [
      {
        name: 'Acme',
        sourceAttribution: [
          ' https://example.com/leading-space',
          '/img/http://example.com/not-a-url',
          'mailto:hi@example.com?body=https://example.com',
        ],
      },
    ],
  });
  assert.equal(links.size, 0);
});

test('a non-string entry is skipped even when it stringifies to a URL', () => {
  // data/members.json is generated, and a nested array reaches String() as a
  // bare URL. Collecting it would key the map on an object the probe cannot
  // request and the report cannot print.
  const links = collectRenderedMemberLinks({
    members: [
      {
        name: 'Acme',
        sourceAttribution: [
          ['https://example.com/nested'],
          { toString: () => 'https://example.com/coerced' },
        ],
        awards: [{ announcementUrl: ['https://example.com/nested-award'] }],
      },
    ],
  });
  assert.equal(links.size, 0);
});

test('a null member or award is skipped without failing the whole run', () => {
  // A hole in the generated array must not abort collection: the remaining
  // members still have links worth resolving.
  const links = collectRenderedMemberLinks({
    members: [
      null,
      {
        name: 'Acme',
        sourceAttribution: ['https://example.com/a'],
        awards: [null, { announcementUrl: 'https://example.com/announce' }],
      },
    ],
  });
  assert.deepEqual(
    [...links.keys()],
    ['https://example.com/a', 'https://example.com/announce'],
  );
});

test('a URL cited by several members is probed once and reports every citation', () => {
  const links = collectRenderedMemberLinks({
    members: [
      { name: 'Acme', sourceAttribution: ['https://example.com/shared'] },
      { name: 'Globex', sourceAttribution: ['https://example.com/shared'] },
    ],
  });
  assert.equal(links.size, 1);
  assert.deepEqual(links.get('https://example.com/shared'), [
    'Acme sourceAttribution',
    'Globex sourceAttribution',
  ]);
});

test('a member without a name is still attributed rather than dropped', () => {
  const links = collectRenderedMemberLinks({
    members: [{ sourceAttribution: ['https://example.com/a'] }],
  });
  assert.deepEqual(links.get('https://example.com/a'), [
    '(unnamed member) sourceAttribution',
  ]);
});

test('non-http values and absent collections are skipped', () => {
  const links = collectRenderedMemberLinks({
    members: [
      {
        name: 'Acme',
        sourceAttribution: [
          'mailto:hi@example.com',
          '/img/local.svg',
          null,
          42,
        ],
        awards: [{}],
      },
      { name: 'Globex' },
    ],
  });
  assert.equal(links.size, 0);
});

test('a document with no members yields no links', () => {
  assert.equal(collectRenderedMemberLinks({}).size, 0);
  assert.equal(collectRenderedMemberLinks(undefined).size, 0);
});

test('a host that answers is alive even when it declines the request', () => {
  // Corporate homepages behind a WAF answer an automated probe with 403 or
  // 406 while serving a browser normally; treating those as rot would leave
  // the gate permanently red.
  for (const status of [200, 204, 301, 403, 405, 406, 500, 503]) {
    assert.equal(classifyProbe({ status }), 'alive', `status ${status}`);
  }
});

test('only the statuses asserting the resource is gone count as dead', () => {
  assert.deepEqual(DEAD_STATUS_CODES, [404, 410]);
  for (const status of DEAD_STATUS_CODES) {
    assert.equal(classifyProbe({ status }), 'dead', `status ${status}`);
  }
});

test('a name that does not resolve is dead', () => {
  assert.equal(classifyProbe({ errorCode: 'ENOTFOUND' }), 'dead');
});

test('any other transport failure is inconclusive rather than dead', () => {
  // The gate runs from CI against third-party hosts: a refused connection, a
  // TLS error or a proxy fault must not be reported as rot in the data.
  for (const errorCode of [
    'ECONNREFUSED',
    'ECONNRESET',
    'EAI_AGAIN',
    'CERT_HAS_EXPIRED',
    'TimeoutError',
    null,
  ]) {
    assert.equal(
      classifyProbe({ errorCode }),
      'inconclusive',
      `code ${errorCode}`,
    );
  }
  assert.equal(classifyProbe(), 'inconclusive');
  assert.equal(classifyProbe({}), 'inconclusive');
});

test('a name that never resolved is dead once the run proves the resolver worked', () => {
  // A broken delegation answers SERVFAIL, which reaches Node as EAI_AGAIN
  // even though it is permanent. One reachable host in the same run rules
  // out the alternative explanation, a resolver that was simply down.
  const verdicts = resolveVerdicts([
    { verdict: 'inconclusive', probe: { errorCode: 'EAI_AGAIN' } },
    { verdict: 'alive', probe: { status: 200 } },
  ]);
  assert.deepEqual(verdicts, ['dead', 'alive']);
});

test('an unresolved name stays inconclusive when nothing in the run resolved', () => {
  // Every probe failing is what a CI runner with no DNS looks like; calling
  // those links rot would accuse the data of a fault in the infrastructure.
  const verdicts = resolveVerdicts([
    { verdict: 'inconclusive', probe: { errorCode: 'EAI_AGAIN' } },
    { verdict: 'inconclusive', probe: { errorCode: 'EAI_AGAIN' } },
  ]);
  assert.deepEqual(verdicts, ['inconclusive', 'inconclusive']);
});

test('a dead verdict in the run is enough to trust an unresolved name', () => {
  const verdicts = resolveVerdicts([
    { verdict: 'inconclusive', probe: { errorCode: 'EAI_AGAIN' } },
    { verdict: 'dead', probe: { status: 404 } },
  ]);
  assert.deepEqual(verdicts, ['dead', 'dead']);
});

test('failures that are not resolution failures stay inconclusive', () => {
  assert.deepEqual(UNRESOLVED_ERROR_CODES, ['EAI_AGAIN']);
  const verdicts = resolveVerdicts([
    { verdict: 'inconclusive', probe: { errorCode: 'ECONNRESET' } },
    { verdict: 'inconclusive', probe: {} },
    { verdict: 'inconclusive', probe: undefined },
    { verdict: 'alive', probe: { status: 200 } },
  ]);
  assert.deepEqual(verdicts, [
    'inconclusive',
    'inconclusive',
    'inconclusive',
    'alive',
  ]);
});

test('an empty run yields no verdicts', () => {
  assert.deepEqual(resolveVerdicts([]), []);
});

test('a finding names the verdict, the reason and every citation', () => {
  assert.equal(
    formatFinding('dead', 'https://example.com/a', ['Acme sourceAttribution'], {
      status: 404,
    }),
    'DEAD https://example.com/a (HTTP 404) — cited by Acme sourceAttribution',
  );
  assert.equal(
    formatFinding(
      'inconclusive',
      'https://example.com/b',
      ['Acme sourceAttribution', 'Globex sourceAttribution'],
      { errorCode: 'ECONNRESET' },
    ),
    'UNVERIFIED https://example.com/b (ECONNRESET) — cited by Acme sourceAttribution, Globex sourceAttribution',
  );
});

test('a finding with neither status nor code still states a reason', () => {
  assert.equal(
    formatFinding('inconclusive', 'https://example.com/c', ['Acme'], {}),
    'UNVERIFIED https://example.com/c (unreachable) — cited by Acme',
  );
  assert.equal(
    formatFinding('inconclusive', 'https://example.com/c', ['Acme']),
    'UNVERIFIED https://example.com/c (unreachable) — cited by Acme',
  );
});
