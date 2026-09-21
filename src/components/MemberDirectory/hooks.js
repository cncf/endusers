import { useMemo } from 'react';

export function useFilterOptions(members) {
  return useMemo(() => {
    const industries = new Set();
    const projects = new Set();
    for (const member of members) {
      member.industries.forEach((i) => industries.add(i));
      member.projects.forEach((p) => projects.add(p));
    }
    return {
      industries: Array.from(industries).sort(),
      projects: Array.from(projects).sort(),
    };
  }, [members]);
}
