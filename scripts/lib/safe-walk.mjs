import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Lists the regular files under `dir` without ever following symbolic links.
 *
 * `Dirent.isDirectory()` is false for a symbolic link, so a plain recursive
 * walk yields the link itself as though it were a regular file. Both trees
 * walked in this repository originate in third-party input and end up under
 * static/, which is published verbatim, so an unguarded walk lets an upstream
 * link be copied over as a link, read through, and written back through.
 *
 * @param {string} dir Directory to walk.
 * @param {(path: string) => void} [onSymbolicLink] Called for each link skipped.
 * @returns {string[]} Paths of regular files; links and special files excluded.
 */
export function walkFilesNoSymlinks(dir, onSymbolicLink = () => {}) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      onSymbolicLink(path);
      return [];
    }
    if (entry.isDirectory()) return walkFilesNoSymlinks(path, onSymbolicLink);
    if (!entry.isFile()) return [];
    return [path];
  });
}

/**
 * Reports whether `path` is a real directory rather than a link to one.
 *
 * @param {string} path Path to test.
 * @returns {boolean}
 */
export function isRealDirectory(path) {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}
