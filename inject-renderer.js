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

const TRUNCATED_TEXT = '**[truncated]**';
function truncateLinesArray(lines, maxLength = 2000) {
  let truncatedArray = [];
  let length = 0;
  for (let [i, entry] of lines.entries()) {
    let entryLength = entry.length + 1;
    if (length + entryLength > maxLength) {
      if (length + TRUNCATED_TEXT.length + 1 > maxLength) {
        truncatedArray[i - 1] = TRUNCATED_TEXT;
      } else {
        truncatedArray.push(TRUNCATED_TEXT);
      }
      break;
    }
    truncatedArray.push(entry);
  }
  return truncatedArray.join('\n');
}

// stupid commands
let enableCommands = true;
const PREFIX = '=';
const ALLOWED_GUILDS = new Set(['271781178296500235', '635261572247322639']);
const MESSAGE_MAX_LENGTH = 2000;
const EMBED_MAX_LENGTH = 2000;
const EMBED_MAX_FIELDS = 25;
const EMBED_FIELD_NAME_MAX_LENGTH = 256;
const EMBED_FIELD_VALUE_MAX_LENGTH = 1024;
gatewayEvents.on('MESSAGE_CREATE', async event => {
  if (!enableCommands) return;
  let channel = channelRegistry.getChannel(event.channel_id);
  if (!channel) return;
  if (!ALLOWED_GUILDS.has(event.guild_id)) return;
  if (!event.content.startsWith(PREFIX)) return;
  let messageSplit = event.content.split(' ');
  let args = [messageSplit[0].slice(PREFIX.length), ...messageSplit.slice(1)];
  log('command:', args[0], event);
  switch (args[0].toLowerCase()) {
    case 'annoy': {
      let mentions = event.mentions;
      if (!mentions.length) break;
      let target = mentions[0].id;
      let ntt = `<@${target}> `;
      if (ntt.length > 25) break;
      ntt = ntt + ntt + ntt + ntt + ntt + ntt + ntt + ntt;
      ntt += ntt + ntt + ntt + ntt + ntt + ntt + ntt + ntt;
      await sendMessage(event.channel_id, { content: ntt });
      break;
    }
    case 'wa': {
      let query = args.slice(1).join(' ').replace(/\n/g, ' ');
      let promise = inject.wolframAlphaQuery(query);

      let user = userRegistry.getUser(event.author.id);
      let avatarURL = user.getAvatarURL();
      let username = user.username;
      let displayedQuery = query;
      if (query.length > 100) displayedQuery = query.slice(0, 100) + '...';
      let embed = {
        title: 'WolframAlpha: ' + displayedQuery,
        description: 'Running...',
        timestamp: (new Date()).toISOString(),
        footer: {
          icon_url: avatarURL,
          text: username
        },
        color: 0x2decfa
      };
      let sent = await sendMessage(event.channel_id, { embed });
      let messageId = sent.body.id;
      
      let response = await promise;
      log('wolframalpha response:', response);

      let baseMessageLength = embed.title.length + username.length;
      process: {
        if (response.failed) {
          embed.color = 0xff0000;
          embed.description = '**No results**';
          break process;
        }

        embed.color = 0x00ff00;
        let description = [];
        let maybeImage = null;

        if (response.timedOut.length) {
          description.push('**Warning**: The following queries timed out: ' + response.timedOut.join(', '));
        }
        for (let { text } of response.warnings) {
          description.push('**Warning**: ' + text);
        }
        if (response.correctedInput && response.originalInput !== response.correctedInput) {
          description.push('**Using input**: ' + response.correctedInput);
        }
        for (let { string } of response.assumptions) {
          description.push(string);
        }
        for (let topic of response.futureTopic) {
          description.push(`**${topic.topic}**: ${topic.msg}`);
        }
        if (response.erroredPods.length) {
          description.push('**Warning**: The following pods errored: ' +
            response.erroredPods.map(pod => pod.id).join(', '));
        }

        if (!response.pods.size) {
          embed.color = 0xff0000;
          description.unshift('**Warning**: No pods in response (query timed out?)');
          embed.description = truncateLinesArray(description, EMBED_MAX_LENGTH - baseMessageLength);
          break process;
        }

        let fields = [];
        podLoop: for (let pod of response.pods.values()) {
          let value = [];
          let stepByStepPod = response.stepByStep.get(pod.position);
          if (pod.error) value.push('**Warning**: this pod errored');
          if (pod.subpods) {
            for (let subpod of pod.subpods) {
              if (subpod.plaintext) {
                // i shit you not this is literally in their code
                // maybe lift this constant somewhere
                const REQUIRES_INTERACTIVITY = '(requires interactivity)';
                if (subpod.plaintext === REQUIRES_INTERACTIVITY) {
                  if (!stepByStepPod) continue podLoop;
                } else value.push(subpod.plaintext);
              } else if (subpod.img) {
                value.push('**Image**: ' + subpod.img.src);
                if (!maybeImage) maybeImage = subpod.img.src;
              } else value.push('(no representation available)');
            }
          }
          if (pod.async) value.push('**Async pod data**: ' + pod.async);
          if (stepByStepPod) {
            value.push('**Step by step**: ' + stepByStepPod.title);
            for (let subpod of stepByStepPod.subpods) {
              if (subpod.plaintext) value.push(subpod.plaintext);
              else if (subpod.img) value.push('**Image**: ' + subpod.img.src);
              else value.push('(no representation available)');
            }
          }
          if (!value.length) value.push('No data (possible pod error?)');
          fields.push({
            name: pod.title.slice(0, EMBED_FIELD_NAME_MAX_LENGTH),
            value: truncateLinesArray(value, EMBED_FIELD_VALUE_MAX_LENGTH)
          });
        }
        let makePodLimitWarning = n => `**Warning**: only the first ${n} pods are shown`;
        let podLimitWarning = null;
        if (fields.length > EMBED_MAX_FIELDS) {
          fields = fields.slice(0, EMBED_MAX_FIELDS);
          podLimitWarning = EMBED_MAX_FIELDS;
        }

        const DESCRIPTION_MAX_LENGTH = 1000;
        let descriptionMaxLength = DESCRIPTION_MAX_LENGTH;
        embed.description = truncateLinesArray(description, descriptionMaxLength);
        let embedLength = baseMessageLength + Math.min(embed.description.length + (podLimitWarning
          ? makePodLimitWarning(podLimitWarning).length
          : 0), descriptionMaxLength);
        embed.fields = []
        for (let field of fields) {
          let fieldLength = field.name.length + field.value.length;
          if (embedLength + fieldLength > EMBED_MAX_LENGTH) {
            let exceededLength =  (embedLength + makePodLimitWarning(embed.fields.length).length) - EMBED_MAX_LENGTH;
            if (!podLimitWarning && exceededLength > 0) {
              // try to fit warning in
              descriptionMaxLength -= exceededLength;
            }
            // replace existing warning
            podLimitWarning = embed.fields.length;
            break;
          } else {
            embedLength += fieldLength;
            embed.fields.push(field);
          }
        }
        if (podLimitWarning) description.unshift(makePodLimitWarning(podLimitWarning));
        embed.description = truncateLinesArray(description, descriptionMaxLength);
        if (maybeImage) {
          embed.image = { url: maybeImage };
        }
        embed.timestamp = (new Date()).toISOString();
      }

      await editMessage(event.channel_id, messageId, { embed });
    }
  }
});
