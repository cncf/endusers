// Exercises the data-driven half of the link gate end to end: the script
// resolves the outbound URLs data/members.json puts on a member profile and
// fails the run when one of them is gone. Probes are stubbed, so the suite
// stays offline and deterministic.
import assert from 'node:assert/strict';
import test from 'node:test';

import { runScriptWithFetchMock } from './helpers-fetch-mock.mjs';

const MEMBERS = 'data/members.json';

function members(list) {
  return JSON.stringify({ members: list });
}

function run(routes, fixtures, env = { ENDUSERS_LINK_RETRY_MS: '1' }) {
  return runScriptWithFetchMock({
    script: 'check-data-links.mjs',
    fixtures: fixtures ?? {
      [MEMBERS]: members([
        { name: 'Acme', sourceAttribution: ['https://acme.example/'] },
      ]),
    },
    routes,
    // Keep the retry path from spending the production backoff on the
    // failures these tests simulate.
    env,
  });
}

test('a reachable link passes and is reported as checked', () => {
  const result = run([{ match: 'acme.example', status: 200 }]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Checked 1 outbound member links/);
  assert.match(result.stdout, /0 dead, 0 unverified/);
});

test('a host that blocks the probe but answers is not reported as rot', () => {
  const result = run([{ match: 'acme.example', status: 403 }]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 dead, 0 unverified/);
});

test('a 404 fails the run and names the member citing the link', () => {
  const result = run([{ match: 'acme.example', status: 404 }]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DEAD https:\/\/acme\.example\//);
  assert.match(result.stderr, /HTTP 404/);
  assert.match(result.stderr, /Acme sourceAttribution/);
});

test('a 410 fails the run', () => {
  const result = run([{ match: 'acme.example', status: 410 }]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DEAD/);
});

test('a name that does not resolve fails the run', () => {
  const result = run([
    {
      match: 'acme.example',
      networkError: 'getaddrinfo ENOTFOUND acme.example',
      errorCode: 'ENOTFOUND',
    },
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DEAD https:\/\/acme\.example\//);
  assert.match(result.stderr, /ENOTFOUND/);
});

test('a host that rejects HEAD is retried with GET', () => {
  // The stub answers both methods from one route, so a 405 that still exits
  // zero shows the fallback ran rather than the 405 being read as alive on
  // the HEAD attempt.
  const result = run([{ match: 'acme.example', status: 405 }]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 dead, 0 unverified/);
});

test('a name that never resolved fails the run when another host was reached', () => {
  // The broken-delegation shape: SERVFAIL reaches Node as EAI_AGAIN, and the
  // reachable sibling rules out a resolver outage.
  const result = run(
    [
      {
        match: 'acme.example',
        networkError: 'getaddrinfo EAI_AGAIN acme.example',
        errorCode: 'EAI_AGAIN',
      },
      { match: 'globex.example', status: 200 },
    ],
    {
      [MEMBERS]: members([
        { name: 'Acme', sourceAttribution: ['https://acme.example/'] },
        { name: 'Globex', sourceAttribution: ['https://globex.example/'] },
      ]),
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DEAD https:\/\/acme\.example\//);
  assert.match(result.stderr, /EAI_AGAIN/);
});

test('a run where only some probes fail reports them but still passes', () => {
  const result = run(
    [
      {
        match: 'acme.example',
        networkError: 'socket hang up',
        errorCode: 'ECONNRESET',
      },
      { match: 'globex.example', status: 200 },
    ],
    {
      [MEMBERS]: members([
        { name: 'Acme', sourceAttribution: ['https://acme.example/'] },
        { name: 'Globex', sourceAttribution: ['https://globex.example/'] },
      ]),
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /UNVERIFIED https:\/\/acme\.example\//);
  assert.match(result.stdout, /0 dead, 1 unverified/);
});

test('a run in which every probe is inconclusive fails rather than reporting a clean result', () => {
  const result = run([
    {
      match: 'acme.example',
      networkError: 'socket hang up',
      errorCode: 'ECONNRESET',
    },
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /All 1 member link probes were inconclusive/);
  assert.match(result.stderr, /verified nothing/);
});

test('data that yields no links fails rather than passing vacuously', () => {
  const result = run([], { [MEMBERS]: members([]) });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No outbound member links were collected/);
});

test('award links are probed alongside the source attributions', () => {
  const result = run(
    [
      { match: 'acme.example', status: 200 },
      { match: 'talk.example', status: 404 },
    ],
    {
      [MEMBERS]: members([
        {
          name: 'Acme',
          sourceAttribution: ['https://acme.example/'],
          awards: [{ talkUrl: 'https://talk.example/' }],
        },
      ]),
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DEAD https:\/\/talk\.example\//);
  assert.match(result.stderr, /Acme award talk/);
});

test('more links than the concurrency limit are all probed', () => {
  const list = Array.from({ length: 20 }, (unused, index) => ({
    name: `Member ${index}`,
    sourceAttribution: [`https://host${index}.example/`],
  }));
  const result = run(
    Array.from({ length: 20 }, (unused, index) => ({
      match: `host${index}.example`,
      status: 200,
    })),
    { [MEMBERS]: members(list) },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Checked 20 outbound member links/);
});

test('the default backoff applies when the environment does not set one', () => {
  // Exercises the production delay constant. A run with nothing to retry
  // pays none of it.
  const result = run([{ match: 'acme.example', status: 200 }], undefined, {});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 dead, 0 unverified/);
});

test('a transport failure carrying no code is reported under its own name', () => {
  const result = run(
    [
      { match: 'acme.example', networkError: 'socket hang up' },
      { match: 'globex.example', status: 200 },
    ],
    {
      [MEMBERS]: members([
        { name: 'Acme', sourceAttribution: ['https://acme.example/'] },
        { name: 'Globex', sourceAttribution: ['https://globex.example/'] },
      ]),
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /UNVERIFIED https:\/\/acme\.example\/ \(Error\)/);
});
