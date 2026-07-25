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

For an isolated browser-automation server, use:

```sh
npm run start:headless
```

It listens only on `127.0.0.1:8091` and disables browser clients, WebSockets, hot reload, live reload, auto-open, static-file watching, and disk output. This keeps automated browser navigation and state separate from the normal `npm start` session on port 8080. Headless Chrome should also use a disposable profile under `.cache/` and a dedicated remote-debugging port.

## Deployment

Pushing `main` runs the GitHub Pages workflow in `.github/workflows/deploy-pages.yml`. The workflow tests the calculator, builds the static site into `dist`, and deploys that artifact to GitHub Pages.
