const electron = require('electron');
const path = require('path');

const log = (...args) => console.log('inject-preload:', ...args);

const CORE_MODULE_PATH = electron.ipcRenderer.sendSync('INJECT_GET_CORE_MODULE_PATH');
log('core module path', CORE_MODULE_PATH);
log('loading DiscordNative');
require(path.join(CORE_MODULE_PATH, 'core.asar/app/mainScreenPreload.js'));

if (window.opener === null) {
  // we are in main window
  window.addEventListener('load', electron.ipcRenderer.send('INJECT_LOAD_COMPLETE'));
}
