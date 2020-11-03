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

/*
function lateResolveModules() {
  log('resolving late modules');
  Object.assign(resolvedModules, resolveModules({
    slowmode: m => m.default && typeof m.default.getSlowmodeCooldownGuess === 'function'
  }));

  slowmode = resolvedModules.slowmode.default;
}
*/

let gatewayEvents = new EventEmitter();

// we get injected before GatewaySocket.connect is called
// hijack connect to get the socket object
let gatewaySocket;
let gatewayConnectOriginal = GatewaySocket.prototype.connect;
GatewaySocket.prototype.connect = function connect() {
  log('intercepted GatewaySocket.connect');
  gatewaySocket = this;
  gatewayConnectOriginal.call(this);
  // lateResolveModules();
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
 * Send a message to a channel, without slowmode handling
 * @param {string} channel Channel id
 * @param {object} body Message body
 */
function sendMessageDirect(channel, body) {
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
    if (!result.ok) {
      messageActions.sendBotMessage(currentChannel, '**Warning**: send message failed: ```json\n' +
        JSON.stringify(result, null, 2) + '\n```');
      reject(result);
    } else resolve(result);
   });
 });
}

class Deferred {
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

/** Slowmode handler */
class SlowmodeQueue {
  constructor() {
    /** @type {Map<string, { channelId: string, body: any, deferred: Deferred }[]>} */
    this.channelQueues = new Map();
    /** @type {Map<string, number>} */
    this.slowmodeTimers = new Map();
  }

  restartCooldown(channelId) {
    let channel = channelRegistry.getChannel(channelId);
    if (!channel.rateLimitPerUser) return;
    let cooldownEnd = channel.rateLimitPerUser * 1000 + Date.now();
    let current = this.slowmodeTimers.get(channelId);
    if (!current || cooldownEnd > current) this.slowmodeTimers.set(channelId, cooldownEnd);
  }

  queryCooldown(channelId) {
    let cooldownEnd = this.slowmodeTimers.get(channelId);
    if (!cooldownEnd) return 0;
    if (cooldownEnd < Date.now()) {
      this.slowmodeTimers.delete(channelId);
      return 0;
    } else return cooldownEnd - Date.now();
  }

  /**
   * Get whether messages to a channel should be queued
   * @param {string} channelId
   */
  shouldQueue(channelId) {
    let channel = this.channelQueues.get(channelId);
    return this.queryCooldown(channelId) > 0 || (channel && !channel.length);
  }

  /**
   * Enqueue a message
   * @param {string} channelId
   * @param {object} body
   * @return {Promise<any>}
   */
  enqueue(channelId, body) {
    let delay = this.queryCooldown(channelId);
    let queue = this.channelQueues.get(channelId);
    let shouldSchedule = false;
    if (!queue) {
      queue = [];
      this.channelQueues.set(channelId, queue);
      shouldSchedule = true;
    }
    let deferred = new Deferred();
    queue.unshift({ channelId, body, deferred });
    if (shouldSchedule) {
      if (delay) setTimeout(() => this.drain(channelId), delay);
      else this.drain(channelId);
    }
    return deferred.promise;
  }

  /**
   * Drain messages in queue for channel
   * @param {string} channelId
   */
  async drain(channelId) {
    let queue = this.channelQueues.get(channelId);
    if (!queue) return; // nothing to do?
    let delay = this.queryCooldown(channelId);
    if (delay) {
      // reschedule to later
      log(`slowmode: rescheduling drain for channel ${channelId} (${delay} ms remaining)`);
      setTimeout(() => this.drain(channelId), delay);
      return;
    }
    let top = queue.pop();
    if (!top) return;
    let result;
    try {
      result = await sendMessageDirect(channelId, top.body);
    } catch (err) {
      if (err.status === 429 && err.body.code === 20016) {
        queue.push(top);
        setTimeout(() => this.drain(channelId), err.body.retry_after * 1000);
        return;
      } else top.deferred.reject(err);
    }
    top.deferred.resolve(result);

    if (!queue.length) this.channelQueues.delete(channelId);
    let ratelimit = channelRegistry.getChannel(channelId).rateLimitPerUser * 1000;
    // inform ui
    dispatcher.dispatch({ type: ActionTypes.SLOWMODE_START_COOLDOWN, channelId });
    if (queue.length) setTimeout(() => this.drain(channelId), ratelimit);
  }

  clearQueues() {
    for (let queue of this.channelQueues.values()) {
      for (let entry of queue) {
        if (entry.deferred) entry.deferred.reject(new Error('slowmode queue cleared'));
      }
    }
    this.channelQueues.clear();
  }
}

let slowmodeQueue = new SlowmodeQueue();

// start slowmode cooldown on self message
gatewayEvents.on('MESSAGE_CREATE', event => {
  if (event.author.id === userRegistry.getCurrentUser().id) {
    slowmodeQueue.restartCooldown(event.channel_id);
  }
});

/**
 * Send a message to a channel
 * @param {string} channel Channel id
 * @param {object} body Message body
 */
async function sendMessage(channel, body) {
  if (!slowmodeQueue.shouldQueue(channel)) return await sendMessageDirect(channel, body);
  else return await slowmodeQueue.enqueue(channel, body);
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
const ALLOWED_GUILDS_EXEMPT = new Set(['guildcommands']);
const MESSAGE_MAX_LENGTH = 2000;
const EMBED_MAX_LENGTH = 2000;
const EMBED_MAX_FIELDS = 25;
const EMBED_FIELD_NAME_MAX_LENGTH = 256;
const EMBED_FIELD_VALUE_MAX_LENGTH = 1024;
gatewayEvents.on('MESSAGE_CREATE', async event => {
  if (!enableCommands) return;
  let channel = channelRegistry.getChannel(event.channel_id);
  if (!channel) return;
  let messageSplit = event.content.split(' ');
  let args = [messageSplit[0].slice(PREFIX.length), ...messageSplit.slice(1)];
  if (!ALLOWED_GUILDS.has(event.guild_id)) {
    if (!ALLOWED_GUILDS_EXEMPT.has(args[0].toLowerCase())) return;
  }
  if (!event.content.startsWith(PREFIX)) return;
  log('command:', args[0], event);
  switch (args[0].toLowerCase()) {
    case 'guildcommands': {
      if (event.author.id !== userRegistry.getCurrentUser().id) return;
      let subcommand = args[1].toLowerCase();
      if (subcommand === 'enable') {
        ALLOWED_GUILDS.add(event.guild_id);
        await sendMessage(event.channel_id, { content: 'commands enabled for guild' });
      } else if (subcommand === 'disable') {
        ALLOWED_GUILDS.delete(event.guild_id);
        await sendMessage(event.channel_id, { content: 'commands disabled for guild' });
      } else await sendMessage(event.channel_id, { content: '?' });
      break;
    }
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
            let exceededLength = (embedLength + makePodLimitWarning(embed.fields.length).length) - EMBED_MAX_LENGTH;
            if (!podLimitWarning && exceededLength > 0) {
              // try to fit warning in
              let lastField;
              do {
                lastField = embed.fields.pop();
                embedLength -= lastField.name.length + lastField.value.length;
              } while (embedLength + fieldLength > EMBED_MAX_LENGTH);
            }
            // replace existing warning
            // we don't have to worry about length as if the pod limit warning already
            // exists it is for 25, which is >= the length of what it needs to be now
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
