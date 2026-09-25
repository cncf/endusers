serve:
    npm run docus:start -- --host 0.0.0.0

import:
    npm run import:architectures
    npm run validate:architectures
    npm run validate:architecture-assets

build:
    npm run validate:architectures
    npm run validate:architecture-assets
    npm run validate:metrics
    npm run validate:awards
    npm run validate:community-people
    npm run validate:community-groups
    npm run validate:launch-metrics
    npm run validate:case-studies
    npm run validate:radar-reports
    npm run validate:button-contrast
    npm run build
