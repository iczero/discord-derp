const electron = require('electron');
const path = require('path');
const fsP = require('fs').promises;

const log = (...args) => console.log('inject-preload:', ...args);

// load the renderer script early
let injectRenderer = fsP.readFile(path.join(__dirname, 'inject-renderer.js'))
  .then(a => {
    log('loaded inject-renderer.js');
    return a.toString();
  });

const CORE_MODULE_PATH = electron.ipcRenderer.sendSync('INJECT_GET_CORE_MODULE_PATH');
log('core module path', CORE_MODULE_PATH);

// prevent discord from deleting your token when opening devtools
let discordNativeWindow = require(path.join(CORE_MODULE_PATH,
    'core.asar/app/discord_native/renderer/window.js'));
discordNativeWindow.setDevtoolsCallbacks = () => {
  log('intercepted DiscordNative.window.setDevtoolsCallbacks');
};

// require old DiscordNative so no functionality is lost
log('loading DiscordNative');
require(path.join(CORE_MODULE_PATH, 'core.asar/app/mainScreenPreload.js'));

let injectExports = Object.create(null);
// ipc is probably safe to export
injectExports.ipc = electron.ipcRenderer;
injectExports.console = console;

if (window.opener === null) {
  // we are in main window
  window.addEventListener('DOMContentLoaded', async () => {
    log('content loaded, injecting renderer script');
    // since contextIsolation is enabled, it is not possible to directly interact
    // with the frame. another script is loaded here for that purpose
    electron.webFrame.executeJavaScript(await injectRenderer);
  });
  electron.contextBridge.exposeInMainWorld('inject', injectExports);
}
