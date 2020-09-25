const electron = require('electron');
const path = require('path');
const { promises: fsP } = require('fs');

// replace index.js in modules/discord_desktop_core with
// module.exports = require('./inject.js');

const log = (...args) => console.log('inject:', ...args);
const MAIN_WINDOW_TITLE = 'Discord';

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

electron.ipcMain.on('INJECT_GET_CORE_MODULE_PATH', event => {
  event.returnValue = path.dirname(require.resolve('discord_desktop_core'))
});

electron.ipcMain.on('INJECT_LOAD_COMPLETE', async event => {
  log('received load complete event, sending renderer inject script');
  let injectRenderer = (await fsP.readFile(path.join(__dirname, 'inject-renderer.js'))).toString();
  event.sender.executeJavaScript(injectRenderer);
});

module.exports = require('discord_desktop_core/core.asar');
