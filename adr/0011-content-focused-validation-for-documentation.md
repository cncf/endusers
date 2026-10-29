# ADR 0011: Content-only pull requests use focused validation

- **Status**: Accepted
- **Date**: 2026-10-29
- **Related**:
  [ADR 0008](./0008-scope-agent-findings-to-user-observable-change.md),
  [ADR 0009](./0009-refresh-generated-data-only-on-content-change.md),
  [ADR 0010](./0010-architecture-pages-are-the-metadata-source.md)

## Context

Every pull request currently runs the repository-wide validation and lint
workflows, the full end-to-end suite, and end-to-end coverage. That includes
unit coverage thresholds, data validators, and code checks even when a
contributor changes only authored documentation. The production build is useful
for documentation changes because it catches broken internal links and invalid
content, but the code and browser suites provide little additional value for a
prose-only change.

Contributors updating end-user documentation should not need to understand
unrelated data pipelines or wait for broad test suites. At the same time,
generated content and mixed changes must keep the checks that validate their
sources and outputs. This decision covers human-maintained documents, not
generated data or pages such as imported architecture pages and generated
catalog content. Updates to generated case-study or radar-report data and other
generated snapshots remain on their existing validation path.

## Decision drivers

- Keep changes to end-user documentation easy to contribute and review.
- Catch formatting, spelling, Markdown, document-contract, and internal-link
  regressions before publication.
- Preserve full validation for code, data, generated content, and mixed changes.
- Preserve the required check names and the merge-queue contract.
- Make uncertain change classification take the safe, full-validation path.
- Do not lower or change any existing coverage or quality thresholds.

## Options considered

1. **Run the existing full workflow for every pull request.** This is simple and
   safe, but requires documentation-only changes to pass unrelated unit, data,
   lint, and browser suites. Rejected because it imposes avoidable contributor
   friction.
2. **Use focused checks for authored-document-only changes and retain full
   checks otherwise.** This keeps the production build and relevant content
   checks while skipping suites that do not exercise prose. Chosen.
3. **Skip CI or the production build for documentation-only changes.** This is
   the fastest option, but can publish broken internal links or invalid
   documentation. Rejected.

## Decision

The CI workflow will classify the changed paths and use two validation paths.

### Authored-document-only changes

A pull request qualifies only when every changed path is a human-maintained
Markdown or MDX document. This includes authored documentation, blog posts,
ADRs, and repository guidance. Generated pages and snapshots are not eligible.
Any code, test, workflow, configuration, data, generated file, non-document
asset, or other unrecognized path makes the change ineligible; a mixed change
uses full validation.

For eligible changes:

- Run formatting, spelling, and Markdown checks on the changed documents.
- Run the applicable document-contract checks, including checks for Markdown
  references and documentation structure.
- Build the production site to validate the rendered content and internal links.
- Skip full unit coverage, data validators unrelated to changed documents, broad
  code lint/duplication/unused checks, and browser tests and coverage.

The exact generated paths and document-contract checks will be maintained
explicitly in the classifier and workflow. Content authored from generated data
remains subject to its existing data validation lane; changes to generated data
or generated outputs always use full validation.

### All other changes

Code, test, workflow, configuration, data, generated-content, mixed, and
unrecognized changes continue to run the existing full validation, lint,
end-to-end, and end-to-end coverage checks. Manual workflow dispatch also keeps
the full path.

The classifier must support both `pull_request` and `merge_group` events. It
must evaluate the complete applicable diff, including additions, deletions, and
renames. If it cannot determine the changed paths or whether an output is
generated, it must select full validation.

The existing required check names remain stable. For document-only changes, the
required validation check still runs the focused content checks and production
build, and the lint check runs the changed-document checks. Browser jobs may be
skipped only when that required content-validation path succeeds. The merge
queue must apply the same classification and safety rules.

## Implementation plan

1. Add and test a change classifier for authored-document-only, generated,
   mixed, code, unknown, and merge-queue diffs. Default classification failures
   to full validation.
2. Adapt the existing CI jobs to use the classifier while retaining their
   required check names. Keep the production build and content-specific checks
   on the document-only path; skip only the unrelated broad suites.
3. Update contributor guidance to explain which checks run for document-only
   changes and when the full suite applies.
4. Verify both paths, including merge-queue behavior, and ensure the
   document-only path cannot pass when its build or focused checks fail.

## Consequences

- A prose-only contribution receives formatting, spelling, Markdown,
  document-contract, and production-build validation without waiting on broad
  code and browser suites.
- Generated-data changes and changes that mix content with code or data retain
  the current full checks.
- Change classification becomes part of the CI trust boundary. Unknown paths,
  missing diff information, or uncertain generated-file status must never
  silently skip validation.
- This decision changes which checks run by change type; it does not change test
  coverage requirements or any other frozen threshold.
