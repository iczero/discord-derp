const electron = require('electron');
const path = require('path');
const fsP = require('fs').promises;
const childProcess = require('child_process');
const EventEmitter = require('events');

const log = (...args) => console.log('inject-preload:', ...args);

// load the renderer script early
let injectRenderer = fsP.readFile(path.join(__dirname, 'inject-renderer.js'))
  .then(a => {
    log('loaded inject-renderer.js');
    return a.toString();
  });

const CORE_MODULE_PATH = electron.ipcRenderer.sendSync('INJECT_GET_CORE_MODULE_PATH');
log('core module path', CORE_MODULE_PATH);

function handleCrash(err) {
  electron.ipcRenderer.sendSync('INJECT_HANDLE_CRASH', err);
  electron.ipcRenderer.sendSync('INJECT_LOG_CRASH', err.stack);
  throw err;
}

process.on('uncaughtException', handleCrash);
process.on('unhandledRejection', handleCrash);

// prevent discord from deleting your token when opening devtools
// OBVIOUS WARNING THAT YOU SHOULD *NEVER* BE PASTING RANDOM UNKNOWN CODE INTO
// DEVTOOLS IF YOU DO NOT KNOW WHAT YOU ARE DOING
// YES, EVEN THIS THING
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
}

{ // TODO: actual modules or something that isn't dumb at least
  const { WolframAlphaApi } = require('wolframalpha-websocket-api');
  let api = new WolframAlphaApi();
  injectExports.wolframAlphaQuery = async query => {
    let response = api.query(query);
    await response.promise;
    return response;
  };
}

{
  async function makeLatexImage(source) {
    let scriptPath = path.join(__dirname, 'latex', 'make-image.sh');
    let proc = childProcess.spawn(scriptPath, {
      stdio: ['pipe', 'pipe', 'inherit']
    });
    proc.stdin.write(source);
    let outputBuffers = [];
    proc.stdout.on('data', d => outputBuffers.push(d));
    // ?????
    setImmediate(() => proc.stdin.end());
    await EventEmitter.once(proc, 'exit');
    let error = proc.exitCode !== 0;
    return {
      error,
      output: new Uint8Array(Buffer.concat(outputBuffers))
    }
  }
  injectExports.makeLatexImage = makeLatexImage;
}

electron.contextBridge.exposeInMainWorld('inject', injectExports);
