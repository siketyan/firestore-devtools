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
chrome.devtools.panels.create(
  "Firestore",
  "/images/icon.png",
  "/panel/index.html",
);
