const electron = require('electron');
const path = require('path');
const fetch = require('cross-fetch');
const fs = require('fs');
const fsP = fs.promises;
const toml = require('@iarna/toml');
const { ElectronBlocker } = require('@cliqz/adblocker-electron');

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
            preload: path.join(__dirname, 'inject-preload.js'),
            // force enable devtools
            devTools: true
          });

        } else {
          log('created window does not match title', MAIN_WINDOW_TITLE);
        }
        super(opts);
        // install adblocker
        (async () => {
          const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
            path: path.join(__dirname, '.adblocker.cache'),
            read: fsP.readFile,
            write: fsP.writeFile
          });
          blocker.enableBlockingInSession(this.webContents.session);
          log('installed adblocker on window', opts.title);

          blocker.on('request-blocked', (request) => {
            log('blocked', request.url, 'on window', opts.title);
          });
        })();
        if (isMainWindow) {
          // store the main window for later
          mainWindow = this;
          // install custom error handler
          this.webContents.on('crashed', (_event, killed) => {
            // so usually you'd expect event to contain details about why everything
            // is on fire, but in this case, for some reason, it doesn't.
            // the following code is pretty much useless
            if (killed) {
              log('main window killed');
              return;
            }
            console.error('inject: main window crashed!');
            console.error(_event);
          });
        }
      }
    }
    exports.BrowserWindow = BrowserWindow;
    return exports;
  }
});

// try to load extensions
const EXTENSION_IDS = [
  'fmkadmapgofadopljbjfkapdkoienihi', // React DevTools
  //'cjpalhdlnbpafiamejdnhcphjbkeiagm' // uBlock Origin (does not seem to work)
];
(async () => {
  // electron app ready event seems to already have fired
  // grab chromeDataPath from config
  let configFile = (await fsP.readFile(path.join(__dirname, 'config.toml'))).toString();
  let config = toml.parse(configFile);
  let chromeDataPath;
  if (config.chromeDataPath) {
    chromeDataPath = config.chromeDataPath;
  } else {
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
        log('unknown platform, not loading extensions');
        return;
    }
  }

  for (const EXTENSION_ID of EXTENSION_IDS) {
    let extensionDir = path.join(chromeDataPath, 'Default/Extensions', EXTENSION_ID);
    let versions;
    try {
      versions = await fsP.readdir(extensionDir);
    } catch (err) { /* handled later */ }
    if (!versions || !versions.length) {
      log(`could not find extension ${EXTENSION_ID} in default profile`);
      return;
    }

    let version = versions[versions.length - 1];
    let extensionPath = path.join(extensionDir, version);
    try {
      const ext = await electron.session.defaultSession.loadExtension(extensionPath);
      log('loaded extension', ext.name, 'version', ext.version);
    } catch (err) {
      log(`failed to load extension ${EXTENSION_ID}: `, err);
    }
  }
})();

// actually load the module itself
// everything before this should not assume discord exists
module.exports = require('discord_desktop_core/core.asar');

// inject-preload needs this path to load DiscordNative and modules are not in
// the require path for renderer processes
electron.ipcMain.on('INJECT_GET_CORE_MODULE_PATH', event => {
  event.returnValue = path.dirname(require.resolve('discord_desktop_core'));

  // ensure devtools is enabled
  const discordCreateApplicationMenu = require('discord_desktop_core/core.asar/app/applicationMenu');
  electron.Menu.setApplicationMenu(discordCreateApplicationMenu(true));
});

// crash handling because electron sucks at handling crashes
electron.ipcMain.on('INJECT_HANDLE_CRASH', (event, error) => {
  console.error('\ninject: ======================================');
  console.error('inject: main window crashed!');
  console.error(error);
  console.error('');
  event.returnValue = null;
});
electron.ipcMain.on('INJECT_LOG_CRASH', (event, error) => {
  console.error('inject: crash stack trace');
  console.error(error);
  console.error('');
  event.returnValue = null;
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
