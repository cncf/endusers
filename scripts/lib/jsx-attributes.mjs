/**
 * Safe emission of JSX attributes for generated MDX.
 *
 * Imported architecture Markdown comes from cncf/architecture and is rendered
 * into `<CNCFProjectCard />` tags by the unattended daily import. The values
 * are third-party input, so they must not be able to end the attribute they
 * are written into.
 *
 * A quoted JSX attribute cannot carry an arbitrary string: JSX attribute values
 * are not JavaScript string literals and do not honour backslash escapes, so
 * the `\"` that `JSON.stringify` produces is a literal backslash followed by a
 * value-terminating quote. Everything after it is parsed as further attributes
 * on the same element, which lets upstream text inject a live prop such as
 * `dangerouslySetInnerHTML`.
 *
 * An expression attribute has no such gap: inside `{ ... }` MDX parses real
 * JavaScript, where `JSON.stringify` output is a correctly escaped string
 * literal and cannot break out.
 */

/**
 * Renders one JSX attribute as ` name={"value"}`.
 *
 * @param {string} name - Attribute name; must be a plain JSX identifier.
 * @param {unknown} value - Attribute value, serialized as a JSON string literal.
 * @returns {string} The attribute, including its leading space.
 */
export function jsxAttribute(name, value) {
  if (!/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(name)) {
    throw new Error(`Unsafe JSX attribute name: ${JSON.stringify(name)}`);
  }
  return ` ${name}={${JSON.stringify(String(value))}}`;
}

/**
 * Renders a self-closing JSX element with expression-form attributes.
 *
 * Attributes whose value is null, undefined or the empty string are omitted, so
 * an absent optional field does not render as an empty prop.
 *
 * @param {string} element - Element name; must be a plain JSX identifier.
 * @param {Record<string, unknown>} attributes
 * @returns {string}
 */
export function jsxElement(element, attributes) {
  if (!/^[A-Za-z_$][A-Za-z0-9_$.-]*$/.test(element)) {
    throw new Error(`Unsafe JSX element name: ${JSON.stringify(element)}`);
  }
  const rendered = Object.entries(attributes)
    .filter(
      ([, value]) => value !== null && value !== undefined && value !== '',
    )
    .map(([name, value]) => jsxAttribute(name, value))
    .join('');
  return `<${element}${rendered} />`;
}
