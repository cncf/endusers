// Netlify build entry point (ADR 0005), invoked by `npm run build:netlify`
// from netlify.toml.
//
// Two jobs. First, derive SITE_URL from the deploy context when the
// environment does not set it: Netlify exposes the production URL as URL and
// the per-deploy URL as DEPLOY_PRIME_URL, so canonical and Open Graph URLs
// follow the host a deploy is actually served from -- including the custom
// domain, once attached -- with no config edit. An explicit SITE_URL always
// wins so local and CI builds are unaffected.
//
// Second, run the validators before the production build. Automation pull
// requests never start ci.yml (#755), so this is the only gate their data
// passes before publishing; the first non-zero exit stops the sequence and
// fails the deploy, and Netlify keeps the previous deploy live.

import { spawnSync } from 'node:child_process';

const PREVIEW_CONTEXTS = new Set(['deploy-preview', 'branch-deploy']);

export const BUILD_STEPS = Object.freeze([
  ['npm', ['run', 'validate:all']],
  ['npm', ['run', 'build:production']],
]);

/**
 * The SITE_URL a build should use, or undefined to leave the
 * docusaurus.config.js default in place.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | undefined}
 */
export function resolveSiteUrl(env) {
  if (env.SITE_URL) return env.SITE_URL;
  if (env.CONTEXT === 'production' && env.URL) return env.URL;
  if (PREVIEW_CONTEXTS.has(env.CONTEXT) && env.DEPLOY_PRIME_URL) {
    return env.DEPLOY_PRIME_URL;
  }
  return undefined;
}

/**
 * Runs the build steps in order, stopping at the first failure.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {(command: string, args: string[], env: NodeJS.ProcessEnv) => number} run
 * @returns {number} the exit status of the last step run
 */
export function runBuild(env, run) {
  const siteUrl = resolveSiteUrl(env);
  const buildEnv = siteUrl ? { ...env, SITE_URL: siteUrl } : { ...env };
  for (const [command, args] of BUILD_STEPS) {
    const status = run(command, args, buildEnv);
    if (status !== 0) return status;
  }
  return 0;
}

function spawnStep(command, args, env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = runBuild(process.env, spawnStep);
}
