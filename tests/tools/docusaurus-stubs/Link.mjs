// Test stub for `@docusaurus/Link`.
//
// The real component wraps the router and renders an `<a>`, mapping its `to`
// prop onto `href`. Unit tests only care about the element that ends up in the
// tree, so this stub renders the same anchor without the router.

import React from 'react';

export default function Link({ to, href, children, ...rest }) {
  return React.createElement('a', { href: to ?? href, ...rest }, children);
}
