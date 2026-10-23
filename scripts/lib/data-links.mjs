/**
 * Collection and classification helpers for the data-driven link-rot gate
 * (scripts/check-data-links.mjs).
 *
 * The weekly markdown gate (`_check:links-md`) enumerates `*.md` files, so
 * outbound URLs that reach a page from `data/*.json` instead of from prose
 * are never resolved. `data/members.json` carries two such sets, both
 * rendered as anchors by src/components/MemberDirectory/MemberProfile.js:
 * every entry of a member's `sourceAttribution`, and the award links beside
 * it. A dead host in either is a broken link on the published site; #1856
 * records the one that reached production, a `www` label whose delegation
 * stopped answering while the apex kept resolving.
 *
 * This module is deliberately free of `node:*` imports and performs no I/O:
 * the callers pass parsed documents in and probe the URLs themselves, so the
 * collection rules and the alive/dead decision can be unit-tested without a
 * network or a fixture tree.
 */

/**
 * Statuses that mean "this URL is gone", as opposed to "the host declined to
 * serve this particular client".
 *
 * A corporate homepage behind a WAF commonly answers an automated probe with
 * 403 (adobe.com, ebay.com, blackrock.com, mercedes-benz.com) or 406
 * (uber.com) while serving a browser normally. Treating those as rot would
 * leave the gate permanently red and train readers to ignore it, so only the
 * two statuses that assert the resource itself is absent count as dead.
 */
export const DEAD_STATUS_CODES = Object.freeze([404, 410]);

/**
 * Collect the outbound URLs that MemberProfile.js renders as anchors.
 *
 * Uses a Map keyed by URL so a host cited by several members is probed once
 * while still reporting every place it is cited.
 *
 * @param {object} membersData Parsed `data/members.json`.
 * @returns {Map<string, string[]>} URL to the citation labels that use it.
 */
export function collectRenderedMemberLinks(membersData) {
  const links = new Map();
  const add = (url, where) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    const seen = links.get(url);
    if (seen) seen.push(where);
    else links.set(url, [where]);
  };
  for (const member of membersData?.members || []) {
    const name = member?.name || '(unnamed member)';
    for (const url of member?.sourceAttribution || []) {
      add(url, `${name} sourceAttribution`);
    }
    for (const award of member?.awards || []) {
      add(award?.announcementUrl, `${name} award announcement`);
      add(award?.caseStudyUrl, `${name} award case study`);
      add(award?.talkUrl, `${name} award talk`);
    }
  }
  return links;
}

/**
 * Decide what a completed probe means on its own.
 *
 * `status` is the HTTP status when the host answered, and `errorCode` is the
 * Node error code when it did not. A name that does not exist is rot. Any
 * other transport failure (a refused connection, a TLS error, a proxy fault,
 * a resolver that could not answer) is inconclusive at this stage, because
 * the gate runs from CI against third-party hosts and must not turn a local
 * outage into a false accusation of rot. {@link resolveVerdicts} revisits the
 * ambiguous ones with evidence from the rest of the run.
 *
 * @param {{status?: number|null, errorCode?: string|null}} probe
 * @returns {'alive'|'dead'|'inconclusive'}
 */
export function classifyProbe({ status = null, errorCode = null } = {}) {
  if (typeof status === 'number') {
    return DEAD_STATUS_CODES.includes(status) ? 'dead' : 'alive';
  }
  return errorCode === 'ENOTFOUND' ? 'dead' : 'inconclusive';
}

/**
 * Error codes that mean "this name could not be resolved", short of the
 * NXDOMAIN that {@link classifyProbe} already calls dead.
 *
 * A broken delegation answers SERVFAIL rather than NXDOMAIN, and the resolver
 * reports that to Node as a temporary failure even when it is permanent. The
 * dead link this gate was built for is exactly that shape: the `www` label of
 * a member homepage is a CNAME into a zone whose authority no longer answers,
 * so every resolver returns SERVFAIL while the apex still resolves. Treating
 * SERVFAIL as inconclusive on its own would mean never reporting that class.
 */
export const UNRESOLVED_ERROR_CODES = Object.freeze(['EAI_AGAIN']);

/**
 * Apply the run-level rule to probes {@link classifyProbe} left ambiguous.
 *
 * A name that failed to resolve on every attempt is only called dead when the
 * run proves the resolver itself was working: at least one other URL in the
 * same run was reached. That is the condition that separates link rot from a
 * CI runner whose DNS is down — the case that makes a blanket "unresolved
 * means dead" rule unsafe. With no healthy probe to compare against, every
 * unresolved name stays inconclusive.
 *
 * @param {Array<{verdict: string, probe: {errorCode?: string|null}}>} results
 * @returns {string[]} One verdict per entry, in the order given.
 */
export function resolveVerdicts(results) {
  const resolverWorks = results.some(
    (result) => result.verdict !== 'inconclusive',
  );
  return results.map(({ verdict, probe }) => {
    if (verdict !== 'inconclusive') return verdict;
    const unresolved = UNRESOLVED_ERROR_CODES.includes(probe?.errorCode);
    return unresolved && resolverWorks ? 'dead' : 'inconclusive';
  });
}

/**
 * Render the one-line report for a probed URL.
 *
 * @param {'alive'|'dead'|'inconclusive'} verdict
 * @param {string} url
 * @param {string[]} citations Labels from {@link collectRenderedMemberLinks}.
 * @param {{status?: number|null, errorCode?: string|null}} probe
 * @returns {string}
 */
export function formatFinding(verdict, url, citations, probe = {}) {
  const reason =
    typeof probe.status === 'number'
      ? `HTTP ${probe.status}`
      : probe.errorCode || 'unreachable';
  return `${verdict === 'dead' ? 'DEAD' : 'UNVERIFIED'} ${url} (${reason}) — cited by ${citations.join(', ')}`;
}
