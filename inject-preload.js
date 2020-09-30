const electron = require('electron');
const path = require('path');
const fsP = require('fs').promises;

const log = (...args) => console.log('inject-preload:', ...args);

const CORE_MODULE_PATH = electron.ipcRenderer.sendSync('INJECT_GET_CORE_MODULE_PATH');
log('core module path', CORE_MODULE_PATH);
log('loading DiscordNative');
require(path.join(CORE_MODULE_PATH, 'core.asar/app/mainScreenPreload.js'));
// load the renderer script early
let injectRenderer = fsP.readFile(path.join(__dirname, 'inject-renderer.js')).then(a => a.toString());

let injectExports = Object.create(null);
injectExports.ipc = electron.ipcRenderer;

if (window.opener === null) {
  // we are in main window
  window.addEventListener('DOMContentLoaded', async () => {
    log('load complete, injecting renderer script');
    electron.webFrame.executeJavaScript(await injectRenderer);
  });
  electron.contextBridge.exposeInMainWorld('inject', injectExports);
}
