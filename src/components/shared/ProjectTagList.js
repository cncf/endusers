import styles from './ProjectTagList.module.css';

/**
 * Project-tag list shared by MemberDirectory's MemberCard and
 * ReferenceArchitectures' ArchitectureCard grid cards: up to `limit` project
 * names as `.projectTag` chips. Byte-identical in both consumers before this
 * extraction, so no per-consumer styling hook is needed.
 *
 * Callers keep their own guard around whether to render this at all --
 * MemberCard renders nothing when a member has no projects, while
 * ArchitectureCard always renders the (possibly empty) list -- so this
 * component does not add an empty-projects short-circuit of its own and
 * preserves each site's prior behavior.
 *
 * @param {Object} props
 * @param {string[]} props.projects
 * @param {number} [props.limit]
 */
export function ProjectTagList({ projects, limit = 4 }) {
  return (
    <div className={styles.projectsList}>
      {projects.slice(0, limit).map((project) => (
        <span key={project} className={styles.projectTag}>
          {project}
        </span>
      ))}
    </div>
  );
}
