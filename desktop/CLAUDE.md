# desktop/

Electron shell around `../dist`. Its own npm project, so the web app's install and CI never fetch Electron.
`npm start` runs it on a fresh build, `npm run dist` writes installers to `release/`, `npm test` is the smoke test (`APP=<binary>` for a packaged app).

- No preload and no bridge: the app runs on the fixed secure origin `app://edentext`, where Chromium's File System Access API and `queryLocalFonts` work, so `saveFile.ts` and `recentFiles.ts` take their Chromium path unchanged. Electron grants their permissions because no permission handler is set.
- `main.mjs` covers only what a browser does around the page: `http(s)` links go to the system browser, navigation off the origin (a dropped file) is blocked, and `will-prevent-unload` turns the page's silent `beforeunload` block into a discard dialog.
- The service worker cannot register on `app://`; `src/main.ts` already ignores that error.
- Version and metadata come from the root `package.json` (`electron-builder.config.cjs`). The `desktop` job in `.github/workflows/release.yml` builds unsigned installers per platform and uploads them to the tag's release; it repacks the AppImage with appimagetool to embed update information and publish a `.zsync` for AppImageUpdate.
- The macOS `icon.png` is rendered from `icon.svg` (the favicon plant on a white tile in the macOS icon grid); Windows and Linux use the free-standing `public/icon-512.png`. Render with `rsvg-convert -w 1024 -h 1024 icon.svg -o icon.png`.
- A packaged app asks GitHub for the latest release at start and offers its page when it is newer, unless that version was skipped (`skipped-version` in the user data folder); no auto-update, since an unsigned macOS app cannot install one.
- The native dialogs (discard, update) and the macOS menu take their text from `TEXT`, one entry per app locale, picked by the system language the way `resolveBrowserLocale` maps it. Windows and Linux get no menu: the ribbon has every command.
