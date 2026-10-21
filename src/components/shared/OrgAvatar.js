import React from 'react';
import { initials } from './initials';
import styles from './OrgAvatar.module.css';

/**
 * Logo-or-initials avatar shared by MemberDirectory's MemberCard and
 * ReferenceArchitectures' ArchitectureCard grid cards: render the
 * organization's logo image when one is available, else fall back to a
 * circular initials badge. Only the avatar's size, background and font size
 * vary between the two consumers, so those are carried through CSS custom
 * properties set on `wrapperClassName` rather than component props -- this
 * component owns the shared shape, each consumer's own stylesheet owns its
 * dimensions.
 *
 * @param {Object} props
 * @param {string} [props.logoUrl] - Resolved logo image URL, or falsy to
 *   render the initials fallback.
 * @param {string} props.name - Organization name, used for the initials
 *   fallback and as the image's accessible description (empty, since the
 *   wrapper is `aria-hidden` and the card names the organization elsewhere).
 * @param {string} [props.wrapperClassName] - Consumer-supplied class that
 *   composes the shared wrapper rules (`composes: wrapper from
 *   '../shared/OrgAvatar.module.css'`) and sets the sizing custom
 *   properties. Falls back to this module's own `.wrapper` when the
 *   consumer's sizing matches the defaults and no override is needed.
 * @param {boolean} [props.lazy] - Pass `loading="lazy"` on the logo image,
 *   for grids long enough that off-screen cards benefit from it.
 */
export function OrgAvatar({ logoUrl, name, wrapperClassName, lazy = false }) {
  return (
    <div className={wrapperClassName || styles.wrapper} aria-hidden="true">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt=""
          className={styles.logo}
          loading={lazy ? 'lazy' : undefined}
        />
      ) : (
        <span className={styles.initials}>{initials(name)}</span>
      )}
    </div>
  );
}
