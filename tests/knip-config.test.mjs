// knip only sees which src/ components the docs use through the `md` compiler
// in knip.config.js. If it stopped returning a page's imports, every component
// used only from Markdown would be reported unused; if it returned imports
// shown inside code fences, an example would keep a dead file alive.
import assert from 'node:assert/strict';
import test from 'node:test';

import config from '../knip.config.js';

test('the md compiler returns top-level imports and skips fenced examples', () => {
  const page = [
    '---',
    'title: Example',
    '---',
    "import Card from '@site/src/components/Card';",
    '',
    '```mdx',
    "import Example from '@site/src/components/Example';",
    '```',
    '',
    "import { Grid } from '@site/src/components/Grid';",
    '<Card />',
  ].join('\n');
  assert.equal(
    config.compilers.md(page),
    "import Card from '@site/src/components/Card'\n" +
      "import { Grid } from '@site/src/components/Grid'",
  );
});
