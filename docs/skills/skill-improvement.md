---
unlisted: true
---

# Skill: Skill Improvement

This meta-skill defines how to maintain and evolve the agent-facing
documentation structure.

## Lifecycle

1. **Audit**: Regularly check if existing skills match current repo reality.
2. **Refactor**: Merge overlapping skills; split over-sized ones (>500 lines).
3. **Chunking**: Ensure skills are optimized for LLM context windows.

## Adding Skills

- Add entry to `docs/skills/manifest.md`.
- Create skill file with clear "Purpose" and "Constraints" sections.
- Ensure the skill is "agent-first" (imperative, clear boundaries).
- Every manifest row must point at a file that exists; remove rows when skills
  are deleted.
