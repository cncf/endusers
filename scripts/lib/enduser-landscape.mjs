export const LANDSCAPE_CATEGORY = 'CNCF Members';
export const END_USER_SUPPORTER_SUBCATEGORY =
  'End User Supporter and Contributor';

const ROLE_SUFFIX = / \((member|contributor|supporter)\)$/;

function displayName(sourceName) {
  return sourceName.replace(ROLE_SUFFIX, '');
}

function sourceId(category, subcategory, sourceName) {
  return `cncf/landscape#${category}/${subcategory}/${sourceName}`;
}

/**
 * Select and classify the organization records relevant to the End User
 * directory. This function is deliberately pure: collection owns the pinned
 * revision and asset paths, while generation consumes its committed output.
 *
 * @param {object} document Parsed cncf/landscape landscape.yml data.
 * @returns {{records: object[]}}
 */
export function classifyLandscapeDocument(document) {
  const category = (document?.landscape || []).find(
    (entry) => entry?.name === LANDSCAPE_CATEGORY,
  );
  if (!category) {
    throw new Error(`missing landscape category: ${LANDSCAPE_CATEGORY}`);
  }

  const records = [];
  const seen = new Set();
  let foundSupporterSubcategory = false;

  for (const subcategory of category.subcategories || []) {
    const subcategoryName = subcategory?.name;
    if (subcategoryName === END_USER_SUPPORTER_SUBCATEGORY) {
      foundSupporterSubcategory = true;
    }

    for (const item of subcategory?.items || []) {
      const sourceName = item?.name;
      if (typeof sourceName !== 'string' || !sourceName.trim()) {
        throw new Error(
          `landscape item in ${LANDSCAPE_CATEGORY}/${subcategoryName || '<unknown>'} has no name`,
        );
      }

      const match = sourceName.match(ROLE_SUFFIX);
      const role = match?.[1] || null;

      if (
        role === 'contributor' &&
        subcategoryName !== END_USER_SUPPORTER_SUBCATEGORY
      ) {
        throw new Error(
          `contributor record outside ${END_USER_SUPPORTER_SUBCATEGORY}: ${sourceName}`,
        );
      }

      if (subcategoryName === END_USER_SUPPORTER_SUBCATEGORY) {
        if (!role) {
          throw new Error(
            `unrecognized End User Supporter and Contributor role suffix: ${sourceName}`,
          );
        }
        if (role !== 'contributor' && role !== 'supporter') {
          throw new Error(
            `unsupported End User Supporter and Contributor role: ${sourceName}`,
          );
        }
      }

      if (
        item?.enduser === true &&
        role !== 'member' &&
        subcategoryName !== END_USER_SUPPORTER_SUBCATEGORY
      ) {
        throw new Error(
          `enduser record without a member role suffix: ${sourceName}`,
        );
      }

      const included =
        (role === 'member' && item?.enduser === true) ||
        (role === 'contributor' &&
          subcategoryName === END_USER_SUPPORTER_SUBCATEGORY);

      const relevant =
        included ||
        (role === 'supporter' &&
          subcategoryName === END_USER_SUPPORTER_SUBCATEGORY);
      if (!relevant) continue;

      const id = sourceId(LANDSCAPE_CATEGORY, subcategoryName, sourceName);
      if (seen.has(id)) {
        throw new Error(`duplicate landscape sourceId: ${id}`);
      }
      seen.add(id);

      records.push({
        sourceId: id,
        sourceRole: role,
        included,
        classificationReason: included
          ? `selected-${role}`
          : 'legacy-supporter-audit-only',
        sourceName,
        displayName: displayName(sourceName),
        category: LANDSCAPE_CATEGORY,
        subcategory: subcategoryName,
        enduser: item?.enduser === true,
        homepageUrl: item?.homepage_url ?? null,
        joined: item?.joined ?? null,
        logoFilename: item?.logo ?? null,
      });
    }
  }

  if (!foundSupporterSubcategory) {
    throw new Error(
      `missing landscape subcategory: ${END_USER_SUPPORTER_SUBCATEGORY}`,
    );
  }

  return { records };
}
