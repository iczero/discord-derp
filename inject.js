const electron = require('electron');
const { app } = electron;
const { promises: fsP } = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

// replace index.js in modules/discord_desktop_core with
// module.exports = require('./inject.js').core;

const log = (...args) => console.log('inject:', ...args);
const MAIN_WINDOW_TITLE = 'Discord';
const DESKTOP_CORE_PATH = module.parent.path;

let electronModule = require.cache[require.resolve('electron')];
let getElectronExports = Object.getOwnPropertyDescriptor(electronModule, 'exports').get;
delete electronModule.exports;
Object.defineProperty(electronModule, 'exports', {
  enumerable: true,
  configurable: false,
  get() {
    let exportsOriginal = getElectronExports();
    let exports = Object.assign({}, exportsOriginal);
    // monkey-patch electron.BrowserWindow with more fuckery
    class BrowserWindow extends exportsOriginal.BrowserWindow {
      constructor(opts) {
        log('BrowserWindow override');
        if (opts.title === MAIN_WINDOW_TITLE) {
          opts.webPreferences = Object.assign({}, opts.webPreferences, {
            preload: path.join(__dirname, 'inject-preload.js')
          });
        } else {
          log('created window does not match title', MAIN_WINDOW_TITLE);
        }
        super(opts);
      }
    }
    exports.BrowserWindow = BrowserWindow;
    return exports;
  }
});
log('electron module post', electronModule);

/*
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
*/

module.exports = {
  core: require(path.join(DESKTOP_CORE_PATH, 'core.asar')),
  DESKTOP_CORE_PATH
};
