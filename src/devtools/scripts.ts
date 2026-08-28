/**
 * DevTools page. It renders nothing itself; its only job is to register the
 * panel that hosts the React app.
 *
 * The paths are root-relative on purpose. Chrome resolves the arguments of
 * `panels.create` against the extension root, but Firefox resolves them
 * against the devtools page that is calling — so a bare `panel/index.html`
 * becomes `devtools/panel/index.html` there, which does not exist, and the
 * panel opens as a blank white page. A leading slash means the extension root
 * in both.
 */
// The tab renders the icon at 16px, so the 32 is here for the 2x displays; a
// browser on a 1x one halves it exactly. Both paths have to sit in the call as
// plain literals — Extension.js reads them statically to find the panel page,
// and anything between the arguments loses it the entry point.
chrome.devtools.panels.create(
  "Firestore",
  "/images/icon-32.png",
  "/panel/index.html",
);
