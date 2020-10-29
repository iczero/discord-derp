const electron = require('electron');
const path = require('path');
const fs = require('fs');
const fsP = fs.promises;

// replace index.js in modules/discord_desktop_core with
// module.exports = require('/absolute/path/to/inject.js');

const log = (...args) => console.log('inject:', ...args);
const MAIN_WINDOW_TITLE = 'Discord';

let mainWindow = null;

// hijack electron exports
// what follows is supreme hackery that should probably never be used anywhere

// grab actual electron module itself (not its exports) from node.js
let electronModule = require.cache[require.resolve('electron')];
// electron exports a getter, get the actual getter function itself
let getElectronExports = Object.getOwnPropertyDescriptor(electronModule, 'exports').get;
// ... and then delete it
delete electronModule.exports;
// ... and then replace it with our own
Object.defineProperty(electronModule, 'exports', {
  enumerable: true,
  configurable: false,
  get() {
    // call original getter function exported by electron
    let exportsOriginal = getElectronExports();
    // copy exports object, may not be necessary
    let exports = Object.assign({}, exportsOriginal);
    // monkey-patch electron.BrowserWindow with more fuckery
    class BrowserWindow extends exportsOriginal.BrowserWindow {
      constructor(opts) {
        log('intercepted creation of window', opts.title);
        let isMainWindow = opts.title === MAIN_WINDOW_TITLE;
        if (isMainWindow) {
          // replace preload script with our own
          opts.webPreferences = Object.assign({}, opts.webPreferences, {
            preload: path.join(__dirname, 'inject-preload.js')
          });
        } else {
          log('created window does not match title', MAIN_WINDOW_TITLE);
        }
        super(opts);
        // store the main window for later
        if (isMainWindow) mainWindow = this;
      }
    }
    exports.BrowserWindow = BrowserWindow;
    return exports;
  }
});

// try to load react devtools
const REACT_DEVTOOLS_EXTENSION_ID = 'fmkadmapgofadopljbjfkapdkoienihi';
(async () => {
  // electron app ready event seems to already have fired
  let chromeDataPath;
  switch (process.platform) {
    case 'linux':
      chromeDataPath = path.resolve(process.env.HOME, '.config/google-chrome');
      break;
    case 'win32':
      chromeDataPath = path.resolve(process.env.LOCALAPPDATA, 'Google/Chrome/User Data');
      break;
    case 'darwin':
      chromeDataPath = path.resolve(process.env.HOME, 'Library/Application Support/Google/Chrome');
      break;
    default:
      log('unknown platform, not loading react devtools');
      return;
  }

  let extensionDir = path.join(chromeDataPath, 'Default/Extensions', REACT_DEVTOOLS_EXTENSION_ID);
  let versions;
  try {
    versions = await fsP.readdir(extensionDir);
  } catch (err) { /* handled later */ }
  if (!versions || !versions.length) {
    log('could not find react devtools in default profile');
    return;
  }

  let version = versions[versions.length - 1];
  let extensionPath = path.join(extensionDir, version);
  if (electron.BrowserWindow.addDevToolsExtension(extensionPath)) {
    log('loaded react devtools, version', version);
  } else {
    log('failed to load react devtools');
  }
})();

// actually load the module itself
// everything before this should not assume discord exists
module.exports = require('discord_desktop_core/core.asar');

// inject-preload needs this path to load DiscordNative and modules are not in
// the require path for renderer processes
electron.ipcMain.on('INJECT_GET_CORE_MODULE_PATH', event => {
  event.returnValue = path.dirname(require.resolve('discord_desktop_core'))
});

{
  // mpv thing lol
  const childProcess = require('child_process');
  electron.ipcMain.handle('INJECT_LAUNCH_MPV', (event, media) => {
    // can't stick it in preload because of this
    let widBuf = electron.BrowserWindow.fromWebContents(event.sender).getNativeWindowHandle();
    let wid = widBuf.readUInt32LE();
    log('starting mpv on wid', wid, 'for', media)
    childProcess.spawn('mpv', [
      '--wid=' + wid,
      '--keep-open=no',
      '--',
      media
    ], {
      stdio: ['ignore', 'inherit', 'inherit']
    });
  });
}
