# Contributing to EdenText

Thanks for your interest in contributing! This document explains how to get set up
and the one legal requirement for getting a change merged.

## Development setup

```bash
npm install
npm run dev      # start the dev server (Vite, hot-reload)
npm run build    # production build → dist/
npm run preview  # serve the dist/ build locally
```

## Tests

```bash
npm run check    # svelte-check type-check
npm test         # Vitest suite (tests/**/*.test.ts, jsdom)
npm run test:lo  # LibreOffice round-trip leg — self-skips without `soffice`
npm run test:smoke   # boots the dist/ build in headless Chromium
```

CI runs `check` + `test` on every pull request, plus the LibreOffice round-trip
and the headless smoke test in separate jobs. Please make sure `npm run check`
and `npm test` pass locally before opening a PR.

There is no linter or formatter — match the surrounding code style, keep changes
focused, and describe what you changed and why in your pull request.

## License of the project

This project is released to the public under the **GNU Affero General Public
License v3.0 (AGPL-3.0-only)** — see [`LICENSE`](./LICENSE). The same code is also
offered under a separate **commercial license** for organisations that cannot
comply with the AGPL (see [`LICENSE.commercial.md`](./LICENSE.commercial.md)).

## Contributor License Agreement (CLA) — required

Because the project is **dual-licensed** (AGPL for everyone + a commercial license),
the maintainer must be able to license *all* of the code — including your
contribution — under both sets of terms. To make that possible, every contributor
must agree to the **Contributor License Agreement** in [`CLA.md`](./CLA.md) before
their first contribution can be merged.

In short, the CLA confirms that:

- you wrote the contribution yourself (or have the right to submit it), and
- you grant the maintainer the right to license your contribution under **both**
  the AGPL **and** the commercial license.

You keep the copyright to your contribution — you are only granting a license.

### How to sign

> **Recommended:** set up [CLA Assistant](https://github.com/cla-assistant/cla-assistant)
> so the agreement is presented and recorded automatically on each pull request.

Until that is in place, sign by adding the following line to your pull request
description (replacing the placeholders):

```
I have read and agree to the CLA. — <Full Name>, <email>, <date>
```

## Reporting bugs / requesting features

Please open a GitHub issue with clear reproduction steps (for bugs) or a concise
description of the use case (for features).
