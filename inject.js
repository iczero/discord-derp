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

module.exports = require('discord_desktop_core/core.asar');

{
  // mpv thing lol
  const childProcess = require('child_process');
  electron.ipcMain.handle('INJECT_LAUNCH_MPV', (event, media) => {
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
