/* eslint-disable new-cap */
const log = (...args) => inject.console.log('inject-renderer:', ...args);

// prevent sentry from doing anything
window.__SENTRY__.globalEventProcessors = [() => null];
window.__SENTRY__ = null;
window.DiscordSentry = null;

// push a module named 10000000 that exports require(), then run it immediately
// require.c contains all modules registered with webpack
const modulesList = window.webpackJsonp.push([
  [], { 10000000: (module, _exports, require) => module.exports = require.c },
  [[10000000]]
]);
const require = n => modulesList[n].exports;

/**
 * Resolve modules by characteristics
 * @param {object} def
 * @return {object}
 */
function resolveModules(def) {
  let needed = new Set();
  let found = {};
  for (let name of Object.keys(def)) needed.add(name);
  moduleLoop: for (let [i, selectedModule] of Object.entries(modulesList)) {
    for (let name of needed) {
      if (def[name](selectedModule.exports)) {
        log(`found module ${name} at ${i}`);
        found[name] = selectedModule.exports;
        needed.delete(name);
        if (needed.size === 0) break moduleLoop;
      }
    }
  }
  return found;
}

// hardcoding numbers is bad as they change literally every week with new builds
// find modules by searching for matching exports instead
const resolvedModules = resolveModules({
  react: m => typeof m.version === 'string' && m.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
  data: m => m.Endpoints && typeof m.Endpoints.MESSAGES === 'function',
  dispatcher: m => m.default && typeof m.default.subscribe === 'function' && typeof m.Dispatcher === 'function',
  api: m => m.default && typeof m.default.APIError === 'function',
  users: m => m.default && typeof m.default.getUsers === 'function',
  channels: m => m.default && typeof m.default.getChannels === 'function',
  guilds: m => m.default && typeof m.default.getGuilds === 'function',
  events: m => typeof m.EventEmitter === 'function',
  reactDOM: m => typeof m.render === 'function' && typeof m.hydrate === 'function',
  messageActions: m => m.default && typeof m.default.sendMessage === 'function' && typeof m.default.jumpToMessage === 'function',
  messages: m => m.default && typeof m.default.getMessages === 'function',
  messageQueue: m => m.MessageDataType && m.default && typeof m.default.enqueue === 'function',
  gateway: m => typeof m.default === 'function' && m.default.prototype._connect && m.default.prototype._discover
});

const { Endpoints, ActionTypes } = resolvedModules.data;
const dispatcher = resolvedModules.dispatcher.default;
const api = resolvedModules.api.default;
const GatewaySocket = resolvedModules.gateway.default;
const EventEmitter = resolvedModules.events.EventEmitter
const React = resolvedModules.react;
const ReactDOM = resolvedModules.reactDOM;
const userRegistry = resolvedModules.users.default;
const channelRegistry = resolvedModules.channels.default;
const guildRegistry = resolvedModules.guilds.default;
const messageRegistry = resolvedModules.messages.default;
const messageActions = resolvedModules.messageActions.default;
const messageQueue = resolvedModules.messageQueue.default;
const MessageDataType = resolvedModules.messageQueue.MessageDataType;

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

let sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let generateNonce = () => Math.floor(Math.random() * 1e16).toString();

/**
 * Send a message to a channel
 * @param {string} channel Channel id
 * @param {object} body Message body
 */
function sendMessage(channel, body) {
 return new Promise((resolve, reject) => {
   messageQueue.enqueue({
     type: MessageDataType.SEND,
     message: {
       channelId: channel,
       nonce: generateNonce(),
       tts: false,
       ...body
     }
   }, result => {
    if (!result.ok) reject(result);
    else resolve(result);
   });
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

const REGIONAL_INDICATOR_START_1 = 55356;
const REGIONAL_INDICATOR_START_2 = 56806;
const ASCII_LOWERCASE_START = 97;
/**
 * React with an isogram to a message
 * @param {string} channel Channel id
 * @param {string} message Message id
 * @param {string} string Isogram
 */
async function isogramReact(channel, message, string) {
  if (!/^[a-z]+$/.exec(string)) throw new Error('Invalid characters in string');
  let used = new Map();
  let reactions = string.split('').map((s, i) => {
    let char = s.charCodeAt(0) - ASCII_LOWERCASE_START;
    if (used.has(char)) throw new Error(`Not an isogram: character ${s} (index ${i}) is repeated`);
    used.set(char, true);
    return String.fromCharCode(REGIONAL_INDICATOR_START_1, REGIONAL_INDICATOR_START_2 + char);
  });
  for (let react of reactions) {
    await api.put(Endpoints.REACTION(channel, message, react, '@me'));
    await sleep(200);
  }
}

function logArgs(name) {
  return function argsLogger(...args) {
    console.group(name);
    for (let arg of args) console.log(arg);
    console.groupEnd(name);
  }
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
