---
name: skill-improvement
description:
  Use when adding, refactoring, or retiring an agent skill in .agents/skills/ so
  the manifest and front matter stay in sync.
---

# Skill: Skill Improvement

This meta-skill defines how to maintain and evolve the agent-facing
documentation structure.

## Lifecycle

1. **Audit**: Regularly check if existing skills match current repo reality.
2. **Refactor**: Merge overlapping skills; split over-sized ones (>500 lines).
3. **Chunking**: Ensure skills are optimized for LLM context windows.

## Adding Skills

- Create `.agents/skills/<name>/SKILL.md` with `name` and `description` front
  matter, following the [Agent Skills](https://agentskills.io) layout.
- Add entry to `.agents/skills/manifest.md`.
- Give the skill clear "Purpose" and "Constraints" sections.
- Ensure the skill is "agent-first" (imperative, clear boundaries).
- Every manifest row must point at a file that exists; remove rows when skills
  are deleted.
