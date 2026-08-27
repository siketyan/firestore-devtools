/**
 * DevTools page. It renders nothing itself; its only job is to register the
 * panel that hosts the React app.
 */
chrome.devtools.panels.create(
  'Firestore',
  'images/icon.png',
  'panel/index.html'
)
