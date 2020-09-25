/* eslint-disable new-cap */
// don't get logged out (no longer works)
// window.DiscordNative.window.webContents._events['devtools-closed']();

// push a module named 10000 that exports require(), then run it immediately
const require = window.webpackJsonp.push([
  [], { 10000000: (module, exports, require) => module.exports = require },
  [[10000000]]
]);

/**
 * Resolve modules by characteristics
 * @param {object} def
 * @return {object}
 */
function resolveModules(def) {
  let needed = new Set();
  let found = {};
  for (let name of Object.keys(def)) needed.add(name);
  for (let i = 0; i < 1e6; i++) {
    for (let name of needed) {
      let module = require(i);
      if (def[name](module)) {
        console.log(`found module ${name} at ${i}`);
        found[name] = module;
        needed.delete(name);
        if (needed.size === 0) break;
      }
    }
  }
  return found;
}

const modules = resolveModules({
  data: m => m.Endpoints && typeof m.Endpoints.MESSAGES === 'function',
  dispatcher: m => m.default && typeof m.default.subscribe === 'function' && typeof m.Dispatcher === 'function',
  api: m => m.default && typeof m.default.APIError === 'function'
});

const { Endpoints, ActionTypes } = modules.data;
const dispatcher = modules.dispatcher.default;
const api = modules.api.default;

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
