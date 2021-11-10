const electron = require('electron');
const path = require('path');
const fsP = require('fs').promises;
const childProcess = require('child_process');
const EventEmitter = require('events');
// const util = require('util');
const { Keccak, KeccakRand } = require('./keccak');

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

{
  // C  R  Y  P  T  O  G  R  A  P  H  I  C  A  L  L  Y      S  E  C  U  R  E
  // it can roll dice!
  const KECCAK_BITRATE = 512;
  // use 12-round keccak
  let keccak = new Keccak(12);
  let keccakRand = new KeccakRand(keccak, KECCAK_BITRATE);
  let randomFd = null;

  async function randomStuff() {
    let time1 = process.hrtime()[1];
    let readBuf = Buffer.allocUnsafe(keccakRand.byterate);
    let writeBuf = keccakRand.bytesDirect(keccakRand.byterate);
    await Promise.all([
      randomFd.read(readBuf, 0, readBuf.length, null),
      randomFd.write(writeBuf)
    ]);
    keccakRand.seedDirect(readBuf);
    let timeBuf = keccakRand.bytes(2);
    let time = timeBuf.readUInt16BE();
    let time2 = process.hrtime()[1];
    if (time2 < time1) time2 += 1e9;
    let writeTimeBuf = Buffer.alloc(4);
    writeTimeBuf.writeUInt32LE(time2 - time1);
    keccakRand.write(writeTimeBuf);
    randomTimer = setTimeout(randomStuff, time * 10);
    log('random: periodic resync, tdelta', time2 - time1, 'scheduled', time * 10);
  }

  (async () => {
    try {
      // attempt open random device, will only work on linux
      randomFd = await fsP.open('/dev/urandom', 'r+');
      await randomStuff();
      log('random: seeded from /dev/urandom');
    } catch (err) {
      // seed with crypto.randomBytes instead
      keccakRand.seedDirect(require('crypto').randomBytes(keccakRand.byterate * 16));
      log('random: seeded from crypto.randomBytes');
    }
  })();

  injectExports.random = {
    write(s) {
      let writeTimeBuf = Buffer.alloc(4);
      writeTimeBuf.writeUInt32LE(process.hrtime()[1]);
      keccakRand.write(writeTimeBuf);
      keccakRand.write(s);
    },
    read(n, format = null) {
      let buf = keccakRand.bytes(n);
      if (!format) return new Uint8Array(buf);
      else return buf.toString(format);
    },
    float: keccakRand.float.bind(keccakRand),
    floatMany: keccakRand.floatMany.bind(keccakRand),
    int: keccakRand.int.bind(keccakRand),
    intMany: keccakRand.intMany.bind(keccakRand),
    readRaw: keccakRand.bunchOfUint32Arrays.bind(keccakRand)
  };
}

{
  /**
   * Align protein sequences with clustalo
   * Because why not
   * @param {string} input Alignment input
   * @returns {string}
   */
  async function clustalo(input) {
    let proc = childProcess.spawn('clustalo',
      ['-i', '-', '--outfmt=clustal', '--resno'],
      {
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );
    proc.stdin.write(input);
    let outputBuffers = [];
    proc.stdout.on('data', d => outputBuffers.push(d));
    proc.stderr.on('data', d => outputBuffers.push(d));
    // ?????
    setImmediate(() => proc.stdin.end());
    await EventEmitter.once(proc, 'exit');
    return Buffer.concat(outputBuffers).toString();
  }
  injectExports.align = {
    clustalo
  };
}

/*
{
  // idk but it seemed to be useful
  injectExports.inspect = util.inspect.bind(null);
  injectExports.evalInPreload = stuff => eval(stuff);
}
*/

electron.contextBridge.exposeInMainWorld('inject', injectExports);
