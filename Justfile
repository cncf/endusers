serve:
    npm run docus:start -- --host 0.0.0.0

refresh:
    npm run collect:metrics
    npm run collect:enduser-members
    npm run validate:enduser-members
    npm run generate:members
    npm run validate:members
    npm run validate:metrics

build:
    npm run validate:architectures
    npm run validate:architecture-assets
    npm run validate:metrics
    npm run validate:awards
    npm run validate:community-people
    npm run validate:community-groups
    npm run validate:case-studies
    npm run validate:radar-reports
    npm run validate:projects-born
    npm run validate:end-user-talks
    npm run validate:button-contrast
    npm run validate:enduser-members
    npm run validate:members
    npm run build
