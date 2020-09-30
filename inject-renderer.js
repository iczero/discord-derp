/* eslint-disable new-cap */
// push a module named 10000000 that exports require(), then run it immediately
// require.c contains all modules registered with webpack
const modulesList = window.webpackJsonp.push([
  [], { 10000000: (module, _exports, require) => module.exports = require.c },
  [[10000000]]
]);
const require = n => modulesList[n].exports;

const log = (...args) => console.log('inject-renderer:', ...args);

/**
 * Resolve modules by characteristics
 * @param {object} def
 * @return {object}
 */
function resolveModules(def) {
  let needed = new Set();
  let found = {};
  for (let name of Object.keys(def)) needed.add(name);
  for (let i of Object.keys(modulesList)) {
    for (let name of needed) {
      let module = require(i);
      if (def[name](module)) {
        log(`found module ${name} at ${i}`);
        found[name] = module;
        needed.delete(name);
        if (needed.size === 0) break;
      }
    }
  }
  return found;
}

// hardcoding numbers is bad as they change literally every week with new builds
// find modules by searching for matching exports instead
const resolvedModules = resolveModules({
  data: m => m.Endpoints && typeof m.Endpoints.MESSAGES === 'function',
  dispatcher: m => m.default && typeof m.default.subscribe === 'function' && typeof m.Dispatcher === 'function',
  api: m => m.default && typeof m.default.APIError === 'function',
  gateway: m => typeof m.default === 'function' && m.default.prototype._connect && m.default.prototype._discover,
  events: m => typeof m.EventEmitter === 'function'
});

const { Endpoints, ActionTypes } = resolvedModules.data;
const dispatcher = resolvedModules.dispatcher.default;
const api = resolvedModules.api.default;
const GatewaySocket = resolvedModules.gateway.default;
const EventEmitter = resolvedModules.events.EventEmitter

// probably not necessary considering most events get sent to the dispatcher anyways
let gatewayEvents = new EventEmitter();

// we get injected before GatewaySocket.connect is called
// hijack connect to get the socket object
let gatewaySocket;
let gatewayConnectOriginal = GatewaySocket.prototype.connect;
GatewaySocket.prototype.connect = function connect() {
  log('intercepted GatewaySocket.connect');
  gatewaySocket = this;
  gatewayConnectOriginal.call(this);
  gatewaySocket.on('dispatch', (event, ...args) => gatewayEvents.emit(event, ...args));
}

// expose convenience variables for usage in devtools
let currentGuild = null;
let currentChannel = null;
dispatcher.subscribe(ActionTypes.CHANNEL_SELECT, event => {
  currentGuild = event.guildId;
  currentChannel = event.channelId;
});

/**
 * Send a message to a channel
 * @param {string} channel Channel id
 * @param {object} body Message body
 */
async function sendMessage(channel, body) {
  return await api.post({
    url: Endpoints.MESSAGES(channel),
    body: Object.assign({}, {
      nonce: Math.floor(Math.random() * 1e16).toString(),
      tts: false
    }, body)
  });
}

/**
 * Edit a message
 * @param {string} channel Channel id
 * @param {string} message Messsage id
 * @param {object} body Message body
 */
async function editMessage(channel, message, body) {
  return await api.patch({
    url: Endpoints.MESSAGE(channel, message),
    body: Object.assign({}, {
      nonce: Math.floor(Math.random() * 1e16).toString(),
      tts: false
    }, body)
  });
}

// mpv override lmao
// note: is very bad, do not use, can and will delete discord to autoplay gifs
let useMpv = false;
let _play = HTMLVideoElement.prototype.play;
HTMLVideoElement.prototype.play = function play() {
  if (useMpv) {
    log('starting mpv on', this.src);
    inject.ipc.invoke('INJECT_LAUNCH_MPV', this.src);
  } else {
    _play.call(this);
  }
}
