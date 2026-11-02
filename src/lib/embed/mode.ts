// AGPL-3.0-only with an additional term under section 7(b): see NOTICE.md.
// `?embed=1`: the app runs inside another application's iframe, which owns the file.
// A module of its own, since docScope.ts reads it while the import graph is walked.
export const embedded = (() => {
  try { return new URLSearchParams(location.search).has('embed'); } catch { return false; }
})();

// The "Powered by EdenText" notice embedding must keep (NOTICE.md); only a
// build under the commercial license may switch it off.
export const attribution = import.meta.env.VITE_EDENTEXT_ATTRIBUTION !== 'off';

// Such a build embeds white-label: the chrome's logo, which NOTICE.md also requires,
// goes with the notice. The About window, with its licence notices, stays in the menus.
export const whiteLabel = embedded && !attribution;
