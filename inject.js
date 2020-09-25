const electron = require('electron');
const { app } = electron;
const { promises: fsP } = require('fs');

// replace index.js in modules/discord_desktop_core with
// module.exports = require('./inject.js');

const log = (...args) => console.log('inject:', ...args);

// monkey-patch electron.BrowserWindow
let BrowserWindow = electron.BrowserWindow;


let windowCreatedEventReceived = false;
let mainWindow = null;

// TODO: don't know if this is actually the main window, but oh well
app.on('browser-window-created', (_event, window) => {
  log('window launched with id', window.id);
  log('global.mainWindowId is', global.mainWindowId);
  if (windowCreatedEventReceived) {
    log('duplicate browser-window-created event! window id:', window.id);
    return;
  }
  windowCreatedEventReceived = true;

  let loaded = false;
  window.webContents.on('did-finish-load', () => {
    log('main window fired event did-finish-load');
    if (loaded) log('main window reloaded');
    else loaded = true;
    hookRenderer(window);
  });

  setupIpc();
});

async function hookRenderer(window) {
  let webContents = window.webContents;
  let injectRenderer = (await fsP.readFile(__dirname + '/inject-renderer.js')).toString();
  webContents.executeJavaScript(injectRenderer);
  log('injected into renderer process');
  mainWindow = window;
}

async function setupIpc() {
}

module.exports = require('./core.asar');
