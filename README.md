# NMD Map Event Tracker

A browser-based Treasure Map Event progress and shop planner.

Live site: <https://marniks7.github.io/nmd-mapevent/>

The tracker projects shards, fragments, maps, quest rewards, conversions, and shop purchases. Entries and configuration are saved locally in the browser.

## Development

```sh
npm ci
npm start
```

Run the automated checks and production build:

```sh
npm test
npm run build
```

## Deployment

Pushing `main` runs the GitHub Pages workflow in `.github/workflows/deploy-pages.yml`. The workflow tests the calculator, builds the static site into `dist`, and deploys that artifact to GitHub Pages.
