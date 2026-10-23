// Preloaded (`node -r`) into the scripts that runScriptWithFixtures spawns,
// but only while the suite runs under Stryker.
//
// Stryker's instrumented source records which mutants ran on
// `globalThis.__stryker__.mutantCoverage` and reads the active mutant back out
// of the same object. A spawned script gets a fresh global, so it picks the
// active mutant up from `__STRYKER_ACTIVE_MUTANT__` in the inherited
// environment (mutants do reach it) but its coverage counters die with the
// process. Stryker then sees no coverage for any mutant in `scripts/` and
// never schedules it, which is why those files score as untested however many
// assertions the suite makes about them.
//
// This hook writes the child's counters to the file named by
// STRYKER_CHILD_COVERAGE_FILE; runScriptWithFixtures merges them into the test
// process's own `__stryker__` once the child exits.
const fs = require('node:fs');

const target = process.env.STRYKER_CHILD_COVERAGE_FILE;

if (target) {
  const namespace = process.env.STRYKER_NAMESPACE || '__stryker__';
  const hitLimit = process.env.STRYKER_HIT_LIMIT;

  // `hitCount` has to exist before the instrumented module loads, or the
  // guard that aborts an infinite-loop mutant never arms and the child spins
  // until Stryker times out the whole test file.
  if (hitLimit) {
    const ns = globalThis[namespace] || (globalThis[namespace] = {});
    ns.hitLimit = Number(hitLimit);
    ns.hitCount = 0;
  }

  process.on('exit', () => {
    const ns = globalThis[namespace];
    if (!ns) return;
    try {
      fs.writeFileSync(
        target,
        JSON.stringify({
          mutantCoverage: ns.mutantCoverage ?? null,
          hitCount: typeof ns.hitCount === 'number' ? ns.hitCount : null,
        }),
      );
    } catch {
      // A sandbox the test already tore down, a full disk: losing one child's
      // counters must not change the exit status the test asserts on.
    }
  });
}
