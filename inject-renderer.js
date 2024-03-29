/* eslint-disable new-cap */
const logConsole = _earlyExports.console.log.bind(_earlyExports.console, 'inject-renderer:');
const log = (...args) => {
  logConsole(...args);
  _earlyExports.appendEarlyLogFancy('inject-renderer:', ...args);
};

let loadSucceeded

// prevent sentry from doing anything
window.__SENTRY__.globalEventProcessors = [() => null];
window.__SENTRY__ = null;
window.DiscordSentry = null;

// push a fake module and get webpack's require
// require.c contains all modules registered with webpack
let webpackRequire = _earlyExports.webpackRequire;
// window.webpackChunkdiscord_app.push([['_inject'], {}, r => webpackRequire = r]);
const modulesList = webpackRequire.c;
const require = n => modulesList[n].exports;

// type definitions
/**
 * @typedef {object} Channel
 * @property {string} id
 * @property {string | null} guild_id
 * ... more
 */
/**
 * @typedef {object} Guild
 * @property {string} id
 * ... more
 */

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
      if (typeof selectedModule.exports === 'undefined') continue;
      if (def[name](selectedModule.exports)) {
        log(`found module ${name} at ${i}`);
        found[name] = selectedModule.exports;
        needed.delete(name);
        if (needed.size === 0) break moduleLoop;
      }
    }
  }
  if (needed.size) {
    throw new Error([
      'Failed to resolve the following modules:',
      ...needed
    ].join('\n'));
  }
  return found;
}

// hardcoding numbers is bad as they change literally every week with new builds
// find modules by searching for matching exports instead
const resolvedModules = resolveModules({
  react: m => typeof m.version === 'string' && m.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED && typeof m.createElement === 'function',
  data: m => m.Endpoints && typeof m.Endpoints.MESSAGES === 'function',
  dispatcher: m => m.default && typeof m.default.dispatch === 'function' && typeof m.default._currentDispatchActionType !== 'undefined',
  superagent: m => typeof m === 'function' && typeof m.get === 'function' && typeof m.post === 'function',
  componentDispatch: m => typeof m.ComponentDispatch === 'object',
  api: m => m.default && typeof m.default.patch === 'function' && typeof m.default.post === 'function',
  users: m => m.default && typeof m.default.getUsers === 'function',
  channels: m => m.default && typeof m.default.getChannel === 'function',
  guilds: m => m.default && typeof m.default.getGuilds === 'function',
  guildMembers: m => m.default && typeof m.default.getMutableAllGuildsAndMembers === 'function' && typeof m.default.getNicknames === 'function',
  guildChannels: m => m.default && typeof m.default.getChannels === 'function' && m.GUILD_SELECTABLE_CHANNELS_KEY,
  guildMemberCount: m => m.default && typeof m.default.getMemberCount === 'function',
  emojis: m => typeof m.EmojiDisambiguations === 'function' && m.default && m.default.constructor.persistKey === 'EmojiStoreV2',
  permissions: m => m.default && typeof m.default.getChannelPermissions === 'function',
  events: m => typeof m.EventEmitter === 'function',
  reactDOM: m => m.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED && typeof m.render === 'function' && typeof m.hydrate === 'function',
  messageActions: m => m.default && typeof m.default.sendMessage === 'function' && typeof m.default.jumpToMessage === 'function',
  messages: m => m.default && typeof m.default.getMessages === 'function',
  messageQueue: m => m.MessageDataType && m.default && typeof m.default.enqueue === 'function',
  gateway: m => typeof m.default === 'function' && m.default.prototype && m.default.prototype._connect && m.default.prototype.isConnected,
  media: m => m.default && typeof m.default.getMediaEngine === 'function',
  rtcConnection: m => typeof m.default === 'function' && typeof m.default.create === 'function',
  experiments: m => m.default && typeof m.default.isDeveloper !== 'undefined',
  slowmode: m => m.default && typeof m.SlowmodeType === 'object',
  stickers: m => m.default && typeof m.default.getStickerById === 'function',
  guildAvatars: m => m.default && typeof m.default.getGuildMemberAvatarURLSimple === 'function',
  defaultAvatars: m => m.default?.DEFAULT_AVATARS instanceof Array,
  permissionsEvaluator: m => m?.ALLOW && typeof m?.default?.computePermissions === 'function',
  channel: m => typeof m?.default?.prototype?.isActiveThread === 'function' && typeof m?.default?.prototype?.isDM === 'function',
  guild: m => typeof m?.default?.prototype?.getIconSource === 'function' && typeof m?.default?.prototype?.isOwnerWithRequiredMfaLevel === 'function'
});

const { Endpoints, ComponentActions, Permissions, ChannelTypes } = resolvedModules.data;
const dispatcher = resolvedModules.dispatcher.default;
const superagent = resolvedModules.superagent;
const ComponentDispatch = resolvedModules.componentDispatch.ComponentDispatch;
const api = resolvedModules.api.default;
const GatewaySocket = resolvedModules.gateway.default;
const permissionsRegistry = resolvedModules.permissions.default;
const EventEmitter = resolvedModules.events.EventEmitter
const React = resolvedModules.react;
const ReactDOM = resolvedModules.reactDOM;
const userRegistry = resolvedModules.users.default;
const channelRegistry = resolvedModules.channels.default;
const guildRegistry = resolvedModules.guilds.default;
const guildMemberRegistry = resolvedModules.guildMembers.default;
const guildMemberCountRegistry = resolvedModules.guildMemberCount.default;
const messageRegistry = resolvedModules.messages.default;
const messageActions = resolvedModules.messageActions.default;
const messageQueue = resolvedModules.messageQueue.default;
const MessageDataType = resolvedModules.messageQueue.MessageDataType;
const emojiRegistry = resolvedModules.emojis.default;
const EmojiDisambiguations = resolvedModules.emojis.EmojiDisambiguations;
const guildChannelRegistry = resolvedModules.guildChannels.default;
const SlowmodeType = resolvedModules.slowmode.SlowmodeType;
const stickerRegistry = resolvedModules.stickers.default;
const guildAvatarRegistry = resolvedModules.guildAvatars.default;
const { DEFAULT_AVATARS } = resolvedModules.defaultAvatars.default;
const permissionsEvaluator = resolvedModules.permissionsEvaluator.default;
const Channel = resolvedModules.channel.default;
const Guild = resolvedModules.guild.default;

// late load modules
let messageHooks = null;
let replyHandler = null;
let setUnreadPosition = null;
let commands = null;
let ApplicationCommandType = null;
let ApplicationCommandOptionType = null;
let uploader = null;
let MultiUploader = null

function lateResolveModules() {
  log('resolving late modules');
  Object.assign(resolvedModules, resolveModules({
    messageHooks: m => typeof m.useClickMessage === 'function',
    replyHandler: m => typeof m.createPendingReply === 'function',
    // this has got to be the hackiest one yet
    setUnreadPosition: m => typeof m.default === 'function' && m.default.length === 2 && m.default.toString().match(/\.Endpoints\.MESSAGE_ACK\(/),
    commands: m => typeof m.getBuiltInCommands === 'function',
    commandTypes: m => typeof m.ApplicationCommandType === 'object' && typeof m.ApplicationCommandOptionType === 'object',
    uploader: m => m.default?.uploadFiles && m.default?.cancel,
    multiUploader: m => typeof m.default === 'function' && typeof m.MultiUploader === 'function'
  }));

  messageHooks = resolvedModules.messageHooks;
  replyHandler = resolvedModules.replyHandler;
  setUnreadPosition = resolvedModules.setUnreadPosition.default;
  commands = resolvedModules.commands;
  ({ ApplicationCommandType, ApplicationCommandOptionType } = resolvedModules.commandTypes);
  uploader = resolvedModules.uploader.default;
  MultiUploader = resolvedModules.multiUploader.MultiUploader;

  // monkey-patch messageHooks.useClickMessage
  // let oldUseClickMessage = messageHooks.useClickMessage;
  messageHooks.useClickMessage = function patchedUseClickMessage(message, channel) {
    // message and channel are objects, not ids
    return React.useCallback(event => {
      if (event.altKey) {
        if (event.shiftKey) {
          // edit message with alt-shift-click
          if (message.author.id === userRegistry.getCurrentUser().id) {
            messageActions.startEditMessage(channel.id, message.id, messageRegistry.getMessage(channel.id, message.id).content);
            event.preventDefault();
          }
        } else {
          // original functionality (alt-click to set unread position)
          setUnreadPosition(channel.id, message.id);
          event.preventDefault();
        }
      } else if (event.ctrlKey) {
        // reply on ctrl-click, disable mention by default unless shift key held
        replyHandler.createPendingReply({
          channel,
          message,
          shouldMention: event.shiftKey,
          showMentionToggle: true
        });
        // focus text area
        ComponentDispatch.dispatch(ComponentActions.TEXTAREA_FOCUS);
        event.preventDefault();
      }
    }, [message.id, channel.id]);
  };

  // register handler later to ensure no events are dropped
  inject.registerEventHandler(preloadEvents.emit.bind(preloadEvents));
}

// events from preload
let preloadEvents = new EventEmitter();

// events from discord gateway
let gatewayEvents = new EventEmitter();

// we get injected before GatewaySocket.connect is called
// hijack connect to get the socket object
let gatewaySocket;
let gatewayConnectOriginal = GatewaySocket.prototype.connect;
GatewaySocket.prototype.connect = function connect() {
  log('intercepted GatewaySocket.connect');
  gatewaySocket = this;
  gatewayConnectOriginal.call(this);
  if (gatewaySocket._didFinalInit) return;
  gatewaySocket._didFinalInit = true;
  try {
    lateResolveModules();
    gatewaySocket.on('dispatch', (event, ...args) => {
      try {
        gatewayEvents.emit(event, ...args);
      } catch (err) {
        inject.console.error('error in gateway events handler:', err);
      }
    });
  } catch (err) {
    inject.console.error('error in GatewaySocket monkeypatch', err);
  }

  setTimeout(() => _earlyExports.logOverlayContainer.style.display = 'none', 100);
}

// expose convenience variables for usage in devtools
let currentGuild = null;
let currentChannel = null;
dispatcher.subscribe('CHANNEL_SELECT', event => {
  currentGuild = event.guildId;
  currentChannel = event.channelId;
});
function jumpToChannel(id) {
  let channel = channelRegistry.getChannel(id);
  if (!channel) throw new Error('channel not found');
  dispatcher.dispatch({
    type: 'CHANNEL_SELECT',
    guildId: channel.guild_id,
    channelId: channel.id
  });
}

let sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let generateNonce = () => inject.random.int(1e15).toString();
// must use keccak
Math.random = inject.random.float;

/**
 * Pretty-print channel by id
 * @param {string | Channel} channel channel id or object
 * @return {string}
 */
function formatChannel(channel) {
  let id = null;
  if (typeof channel === 'string') {
    id = channel;
    channel = channelRegistry.getChannel(channel);
  }
  if (channel) {
    let guild = guildRegistry.getGuild(channel.guild_id);
    if (guild) {
      return `${guild.name}/#${channel.name} (${channel.id})`;
    } else {
      return `<unknown guild ${channel.guild_id}>/#${channel.name} (${channel.id})`;
    }
  } else {
    return `<unknown channel ${id}>`;
  }
}

/**
 * Pretty-print user by id
 * @param {string | User} user user id or object
 * @return {string}
 */
function formatUser(user) {
  let id = null;
  if (typeof user === 'string') {
    id = user;
    user = userRegistry.getUser(user);
  }
  if (user) {
    return `@${user.username}#${user.discriminator} (${user.id})`;
  } else {
    return `<unknown user ${id}>`;
  }
}

/**
 * Send a message to a channel, without slowmode handling
 * @param {string} channel Channel id
 * @param {object} body Message body
 */
function sendMessageDirect(channel, body) {
  return new Promise((resolve, reject) => {
    let message;
    if (body.file) {
      message = {
        channelId: channel,
        file: body.file,
        filename: body.filename
      };
      if (body.onSend) message.onSend = body.onSend;
      // "remove" fields
      let payload = Object.assign({}, body, {
        file: undefined,
        filename: undefined,
        onSend: undefined
      });
      message.payload_json = JSON.stringify(payload);
    } else {
      message = {
        channelId: channel,
        nonce: generateNonce(),
        tts: false,
        ...body
      };
    }
    if (typeof message.onSend === 'function') {
      // hacky queue send handler
      let onSend = message.onSend;
      delete message.onSend;
      delete message.channelId;
      Object.defineProperty(message, 'channelId', {
        enumerable: true,
        get() {
          onSend();
          return channel;
        }
      })
    }
    messageQueue.enqueue({
      type: MessageDataType.SEND,
      message
    }, result => {
      if (!result.ok) {
        messageActions.sendBotMessage(currentChannel,
          `**Warning**: send message to channel ${formatChannel(message.channelId)} failed` +
          '```json\n// sent message\n' + JSON.stringify(body, null, 2) + '\n```' +
          '```json\n// server response\n' + JSON.stringify(result, null, 2) + '\n```'
        );
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

/**
 * Get effective slowmode cooldown for channel in ms
 * @param {string} channelId
 * @return {number} Slowmode cooldown in ms
 */
function getEffectiveSlowmodeCooldown(channelId) {
  let channel = channelRegistry.getChannel(channelId);
  if (channel.rateLimitPerUser === 0) return 0;
  else if (permissionsRegistry.can(Permissions.MANAGE_CHANNELS, channel)) return 0;
  else if (permissionsRegistry.can(Permissions.MANAGE_MESSAGES, channel)) return 0;
  else return channel.rateLimitPerUser * 1000;
}

/** Slowmode handler */
class SlowmodeQueue {
  constructor() {
    /** @type {Map<string, { channelId: string, body: any, deferred: Deferred, retry: number }[]>} */
    this.channelQueues = new Map();
    /** @type {Map<string, number>} */
    this.slowmodeTimers = new Map();
  }

  restartCooldown(channelId) {
    let ratelimit = getEffectiveSlowmodeCooldown(channelId);
    if (!ratelimit) return;
    let cooldownEnd = ratelimit + Date.now();
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
    let hasQueue = typeof this.channelQueues.get(channelId) !== 'undefined';
    let shouldQueue = hasQueue || this.queryCooldown(channelId) > 0;
    return shouldQueue;
  }

  /**
   * Send a message to a channel, or queue if necessary
   * @param {string} channelId Channel id
   * @param {object | function} body Message body
   * @return {Promise<any>}
   */
  async sendOrEnqueue(channelId, body) {
    let shouldQueue = this.shouldQueue(channelId);
    let hasSlowmode = Boolean(getEffectiveSlowmodeCooldown(channelId));

    if (!shouldQueue && !hasSlowmode) {
      if (typeof body === 'function') body = body(0);
      return await sendMessageDirect(channelId, body);
    } else return await slowmodeQueue.enqueue(channelId, body);
  }

  /**
   * Enqueue a message
   * @param {string} channelId
   * @param {any} body
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
    queue.unshift({ channelId, body, deferred, retry: 0 });
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
      log(`slowmode: drain called while cooldown active, rescheduling drain for channel ${channelId} (${delay} ms remaining)`);
      setTimeout(() => this.drain(channelId), delay);
      return;
    }
    let top = queue.pop();
    if (!top) return;
    let body = top.body;
    if (typeof body === 'function') body = body(top.retry);
    let result;
    try {
      result = await sendMessageDirect(channelId, body);
      top.deferred.resolve(result);
    } catch (err) {
      if (err.status === 429 && err.body.code === 20016) {
        let delay = err.body.retry_after * 1000;
        log(`slowmode: ratelimited by api, rescheduling drain for channel ${channelId} (${delay} ms remaining)`);
        top.retry++;
        queue.push(top);
        setTimeout(() => this.drain(channelId), delay);
        // inform ui
        dispatcher.dispatch({
          type: 'SLOWMODE_SET_COOLDOWN',
          slowmodeType: SlowmodeType.SendMessage,
          channelId,
          cooldownMs: delay
        });
        return;
      } else top.deferred.reject(err);
    }

    if (!queue.length) this.channelQueues.delete(channelId);
    let ratelimit = getEffectiveSlowmodeCooldown(channelId);
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

/** @type {Map<string, (apiReturnTime: number) => void>} */
let pingInfo = new Map();
gatewayEvents.on('MESSAGE_CREATE', event => {
  if (event.author.id === userRegistry.getCurrentUser().id) {
    // start slowmode cooldown on self message
    slowmodeQueue.restartCooldown(event.channel_id);
    // inform ui as well
    dispatcher.dispatch({
      type: 'SLOWMODE_RESET_COOLDOWN',
      slowmodeType: SlowmodeType.SendMessage,
      channelId: event.channel_id
    });

    // gateway ping time tracking
    let pingMatch = event.content.match(/^\(ping (\w+)\)$/);
    if (pingMatch) {
      let id = pingMatch[1];
      let callback = pingInfo.get(id);
      if (callback) callback(Date.now());
    }
  }
});

/** @type {(channelId: string, body: any) => Promise<any>} */
let sendMessage = slowmodeQueue.sendOrEnqueue.bind(slowmodeQueue);

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

// force enable developer mode
/*
Object.defineProperty(resolvedModules.experiments.default, 'isDeveloper', {
  configurable: false,
  enumerable: false,
  get: () => true,
  set: () => {
    throw new Error('santa will not be giving you presents');
  }
});
*/

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
  for (let [i, line] of lines.entries()) {
    let lineLength = line.length + 1;
    if (length + lineLength > maxLength) {
      if (length + TRUNCATED_TEXT.length + 1 > maxLength) {
        truncatedArray[i - 1] = TRUNCATED_TEXT;
      } else {
        truncatedArray.push(TRUNCATED_TEXT);
      }
      break;
    }
    length += lineLength;
    truncatedArray.push(line);
  }
  return truncatedArray.join('\n');
}

function arrayEquals(a1, a2) {
  if (a1.length !== a2.length) return false;
  for (let i = 0; i < a1.length; i++) {
    if (a1[i] !== a2[i]) return false;
  }
  return true;
}

/** stupid semaphore(?) implementation */
class PossiblySemaphore {
  // is this thing even called a semaphore?
  constructor(maxCount = 1) {
    this.maxCount = maxCount;
    this.executing = 0;
    /** @type {Deferred[]} */
    this.queue = [];
  }

  canAcquire() {
    return this.executing < this.maxCount;
  }

  /**
   * Try locking but return immediately if not available
   * @return {boolean} Whether a lock was acquired successfully
   */
  tryAcquire() {
    if (this.executing < this.maxCount) {
      this.executing++;
      return true;
    } else return false;
  }

  /** Acquire lock, blocking (asynchronously) until available */
  async acquire() {
    if (this.tryAcquire()) return;
    let deferred = new Deferred();
    this.queue.unshift(deferred);
    await deferred.promise;
    // acquire not needed
    return;
  }

  async execute(fn) {
    try {
      await this.acquire();
      return await fn();
    } finally {
      this.release();
    }
  }

  release() {
    if (this.executing <= 0) throw new Error('release called too many times?');
    if (this.executing <= this.maxCount) {
      let nextTask = this.queue.pop();
      if (nextTask) {
        nextTask.resolve();
      } else {
        this.executing--;
      }
    } else {
      this.executing--;
    }
  }
}

function randomArrayElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Holds message update handlers
 * Keys are `${channelId}-${messageId}`
 * @type {Map<string, MessageUpdateHandler>}
 */
let messageUpdateHandlers = new Map();

class MessageUpdateHandler {
  /**
   * The constructor
   * @param {string} channelId
   * @param {string} messageId
   * @param {(event: any, handler: MessageUpdateHandler) => any} handler
   * @param {number?} timeout
   */
  constructor(channelId, messageId, handler, timeout = 60000) {
    this.channelId = channelId;
    this.messageId = messageId;
    this.handler = handler;
    this.timeout = timeout;
    this._expireTime = Date.now() + timeout;
  }

  get key() {
    return `${this.channelId}-${this.messageId}`;
  }

  resetTimeout() {
    this._expireTime = Date.now() + this.timeout;
  }

  register() {
    if (messageUpdateHandlers.has(this.key)) {
      throw new Error('attempted to register duplicate message update handler on ' + this.key);
    }
    messageUpdateHandlers.set(this.key, this);
  }

  unregister() {
    messageUpdateHandlers.delete(this.key);
  }

  execute(event) {
    this.handler(event, this);
  }
}

const MESSAGE_UPDATE_HANDLER_CLEANUP_INTERVAL = 5000; // clean up every 5 seconds
let messageUpdateHandlersCleanup = setInterval(() => {
  if (messageUpdateHandlers.size) return;
  for (let [key, value] of messageUpdateHandlers.entries()) {
    let time = Date.now();
    if (value._expireTime < time) messageUpdateHandlers.delete(key);
  }
}, MESSAGE_UPDATE_HANDLER_CLEANUP_INTERVAL);

gatewayEvents.on('MESSAGE_UPDATE', event => {
  let key = `${event.channel_id}-${event.id}`;
  let handler = messageUpdateHandlers.get(key);
  if (handler) handler.execute(event);
});

/** @type {Map<string, Set<(event: any) => any>>} */
/* TODO: this can and will leak memory
let messageDeleteHandlers = new Map();
function registerMessageDeleteHandler(channelId, messageId, fn) {
  let key = `${channelId}-${messageId}`;
  let handlers = messageDeleteHandlers.get(key);
  if (handlers) handlers.add(fn);
  else messageDeleteHandlers.set(key, new Set([fn]));
}
function unregisterMessageDeleteHandler(channelId, messageId, fn) {
  let key = `${channelId}-${messageId}`;
  let handlers = messageDeleteHandlers.get(key);
  if (handlers) handlers.delete(fn);
}
*/
gatewayEvents.on('MESSAGE_DELETE', event => {
  let key = `${event.channel_id}-${event.id}`;
  messageUpdateHandlers.delete(key);
  /*
  let deleteHandlers = messageDeleteHandlers.get(key);
  if (deleteHandlers) {
    for (let fn of deleteHandlers) fn(event);
    messageDeleteHandlers.delete(key);
  }
  */
});

/**
 * Generate v4 uuid
 * @returns {string}
 */
function uuid() {
  let buf = inject.random.read(16);
  // see https://github.com/uuidjs/uuid/blob/master/src/v4.js
  buf[6] = (buf[6] & 0b00001111) | 0x40; // set version
  buf[8] = (buf[8] & 0b00111111) | 0b10000000; // set "clock sequence" bits

  // 4-2-2-2-6
  // xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  let byteToHex = byte => ((byte & 0xf0) >> 4).toString(16) + (byte & 0x0f).toString(16);
  let idx = 0;
  let uuid = [4, 2, 2, 2, 6].map(count => {
    let ret = '';
    for (let i = 0; i < count; i++) ret += byteToHex(buf[idx++]);
    return ret;
  }).join('-');
  return uuid;
}

// custom styling
let cssOverride = document.createElement('style');
document.head.appendChild(cssOverride);
document.body.classList.add('theme-override');
preloadEvents.on('css-update', css => {
  log('received css update from preload');
  cssOverride.innerHTML = css;
});

// stupid commands
let enableCommands = inject.config.enableCommands;
const PREFIX = inject.config.prefix;
const COMMANDS_ALLOWED = new Set(inject.config.commandsAllowed);
const ALLOWED_GUILDS_EXEMPT = new Set(['guildcommands', 'override', 'ordel']);
const MESSAGE_MAX_LENGTH = inject.config.messageMaxLength;
const EMBED_MAX_LENGTH = inject.config.embedMaxLength;
const EMBED_MAX_FIELDS = 25;
const EMBED_FIELD_NAME_MAX_LENGTH = 256;
const EMBED_FIELD_VALUE_MAX_LENGTH = 1024;
const WOLFRAMALPHA_LOADING_MESSAGES = [
  '> Did you know that you can also use your brain to calculate stuff?\n - Bowserinator',
  '> Pretending to understand what you meant...\n - iczero',
  '> Converting 1 dog to joules...\n - iovoid',
  '> Calculating calories in 1 cubic light-year of ice cream...\n - Bowserinator',
  '> This loading message is totally not `sleep(1000)`\n - Bowserinator',
  '> Connecting to BWBellairs\'s home network...\n - Bowserinator',
  '> Mangling your query...\n - iovoid',
  '> Introducing artifical latency to the internet...\n - Bowserinator',
  '> Calculating your weight in eV...\n - iovoid',
  '> Asking ISP why this query is taking so long...\n - Bowserinator',
  '> Re-deriving all of modern mathematics...\n - Bowserinator',
  '> CAPTCHA check: leave the server to prove you are a human (/s)\n - Bowserinator',
  '> Teaching chess to WolframAlpha...\n - iovoid',
  '> Giving WolframAlpha access to a DNA printer...\n - iovoid',
  '> Preparing to paste a very large amount of text...\n - iczero',
];

function resolveUserAvatar(user, guildId = null, size = null) {
  if (user.avatar) {
    let ext = 'png';
    let url;
    let guildAvatarId = user.guildMemberAvatars[guildId];
    if (guildId && guildAvatarId) {
      if (guildAvatarId.startsWith('a_')) ext = 'gif';
      url = new URL(
        Endpoints.GUILD_MEMBER_AVATAR(guildId, user.id, guildAvatarId, ext),
        'https://' + window.GLOBAL_ENV.CDN_HOST
      );
    } else {
      if (user.avatar.startsWith('a_')) ext = 'gif';
      url = new URL(`https://${window.GLOBAL_ENV.CDN_HOST}/avatars/${user.id}/${user.avatar}.${ext}`);
    }
    url.searchParams.set('size', size);
    return url;
  } else {
    return new URL(user.avatarURL, 'https:' + window.GLOBAL_ENV.ASSET_ENDPOINT);
  }
}

// for some... reason, the wolframalpha thing cannot be run twice at the same time
// or discord will commit suicide by SIGILL
let wolframAlphaQueryLock = new PossiblySemaphore(1);

let externalCommands = new Map();

// literally has to be sent on every edit to a reply
const REPLY_NO_PING = {
  allowed_mentions: {
    parse: ['users', 'roles', 'everyone'],
    replied_user: false
  }
};
class ExtCommandContext {
  constructor(event, channel) {
    this.event = event;

    /** @type {string[]} */
    this.args;
    /** @type {string} */
    this.rawArgs;
    this.splitArgs();

    /** @type {Channel} */
    this.channel = channel

    /** @type {Guild | null} */
    this.guild = null;
    if (channel.guild_id) this.guild = guildRegistry.getGuild(channel.guild_id);

    this.source = userRegistry.getUser(event.author.id);
  }

  splitArgs() {
    this.rawArgs = this.event.content.slice(PREFIX.length);
    this.args = this.rawArgs.split(/\s+/);
  }

  shift() {
    this.args.shift();
    let sepMatch = this.rawArgs.match(/\s+/);
    if (sepMatch) this.rawArgs = this.rawArgs.slice(sepMatch.index + sepMatch[0].length);
  }

  sliceRawArgs(n) {
    if (!n) return this.rawArgs;
    let i = 1;
    for (let match of this.rawArgs.matchAll(/\s+/g)) {
      if (i++ >= n) return this.rawArgs.slice(match.index + match[0].length);
    }
  }

  parseArgs(opts) {
    return inject.parseArgs(this.rawArgs, opts);
  }

  /**
   * Parse out code blocks in input, optionally of specific types
   * @param {string[]} [types]
   * @param {number} [sliceAt = 0] slice at argument number
   */
  parseCodeblocks(types = [], sliceAt = 0) {
    let input = this.sliceRawArgs(sliceAt);
    let codeblocks = [...input.matchAll(/`{3}(?:(\w+)\n)?(.+?)`{3}/gs)];
    if (codeblocks.length) {
      let inBlocks;
      // look for codeblocks with the correct types
      // match group 1 is language tag
      let targetBlocks = codeblocks.filter(match => match[1] && types.includes(match[1].toLowerCase()));
      if (targetBlocks.length) {
        // input has matching code blocks, use those
        inBlocks = targetBlocks;
      } else {
        // no blocks with matching type found
        let untypedBlocks = codeblocks.filter(match => !match[1]);
        if (untypedBlocks.length) {
          // untyped blocks found, use those
          inBlocks = untypedBlocks;
        } else {
          // all blocks are of the wrong type? assume typo and use all blocks
          inBlocks = codeblocks;
        }
      }
      input = inBlocks.map(match => match[2]).join('');
    } else if (input.startsWith('`') && input.endsWith('`')) {
      // simple inline codeblock that spans the entire message
      input = input.slice(1, -1);
    }
    return input;
  }

  reply(body, mention = false) {
    body.message_reference = {
      guild_id: this.event.guild_id,
      channel_id: this.event.channel_id,
      message_id: this.event.id
    };
    if (!body.allowed_mentions) {
      body.allowed_mentions = {
        parse: ['users', 'roles', 'everyone'],
        replied_user: mention
      };
    } else {
      body.allowed_mentions.replied_user = mention;
    }
    return sendMessage(this.channel.id, body);
  }

  isSelf() {
    return this.source.id === userRegistry.getCurrentUser().id;
  }
}

function registerExternalCommand(name, fn) {
  if (typeof fn === 'string') {
    let target = externalCommands.get(fn.toLowerCase());
    if (!target) throw new Error('alias references nonexistent command ' + name);
    externalCommands.set(name.toLowerCase(), target);
  } else if (typeof fn === 'function') {
    externalCommands.set(name.toLowerCase(), fn);
  } else throw new Error('wrong argument type');
}

registerExternalCommand('override', async ctx => {
  if (!ctx.isSelf()) return;
  let shouldDelete = ctx.args[0] === 'ordel'
  ctx.shift();
  await runCommand(ctx);
  if (shouldDelete) api.delete(Endpoints.MESSAGE(ctx.channel.id, ctx.event.id));
});
registerExternalCommand('ordel', 'override');
registerExternalCommand('guildcommands', async ctx => {
  if (!ctx.isSelf()) return;
  let subcommand = ctx.args[1].toLowerCase();
  let type;
  let key;
  switch (ctx.channel.type) {
    case ChannelTypes.GUILD_TEXT:
    case ChannelTypes.PRIVATE_THREAD:
    case ChannelTypes.PUBLIC_THREAD:
      type = 'guild';
      key = 'guild:' + ctx.guild.id;
      break;

    case ChannelTypes.DM:
      type = 'DM';
      key = 'userDM:' + ctx.channel.getRecipientId();
      break;

    default:
      return;
  }
  if (subcommand === 'enable') {
    COMMANDS_ALLOWED.add(key);
    await ctx.reply({ content: 'commands enabled for ' + type });
  } else if (subcommand === 'disable') {
    COMMANDS_ALLOWED.delete(key);
    await ctx.reply({ content: 'commands disabled for ' + type });
  } else await ctx.reply({ content: '?' });
});

registerExternalCommand('restart', async ctx => {
  if (!ctx.isSelf()) return;
  window.DiscordNative.app.relaunch();
});
registerExternalCommand('ping', async ctx => {
  let id = generateNonce();
  let gatewayDeferred = new Deferred();
  pingInfo.set(id, gatewayDeferred.resolve);
  let startDate = new Date();
  let sendTs;
  let apiReturnTs;
  let [sent, gatewayReturnTs] = await Promise.all([
    ctx.reply({
      content: `(ping ${id})`,
      onSend: () => sendTs = Date.now()
    }).then(result => {
      apiReturnTs = Date.now();
      return result;
    }),
    gatewayDeferred.promise
  ]);
  let endTs = Date.now();
  let startTs = +startDate;
  let serverTs = +new Date(sent.body.timestamp);
  pingInfo.delete(id);
  let out = [
    `(ping ${id})`,
    `**Total latency** (including queues): ${endTs - startTs} ms`,
    `**API timings**: rtt ${apiReturnTs - sendTs} ms, send ${serverTs - sendTs} ms, return ${apiReturnTs - serverTs} ms`,
    `**Gateway timings**: rtt ${gatewayReturnTs - sendTs} ms, return ${gatewayReturnTs - serverTs} ms`,
  ];
  await editMessage(sent.body.channel_id, sent.body.id, { content: out.join('\n'), ...REPLY_NO_PING });
});
registerExternalCommand('annoy', async ctx => {
  let mentions = ctx.event.mentions;
  if (!mentions.length) target = ctx.source.id;
  let target = mentions[0].id;
  if (Math.random() < 0.05) target = ctx.source.id;
  let ntt = `<@${target}>`;
  if (ntt.length > 25) return;
  ntt = ntt + ntt + ntt + ntt + ntt + ntt + ntt + ntt;
  ntt += ntt + ntt + ntt + ntt + ntt + ntt + ntt + ntt;
  await ctx.reply({ content: ntt });
});
registerExternalCommand('rms', async ctx => {
  // ABSOLUTELY PROPRIETARY
  await ctx.reply({ content: 'https://i.redd.it/7ozal346p6kz.png' });
});
registerExternalCommand('proprietary', 'rms');
registerExternalCommand('getavatar', async ctx => {
  let mentions = ctx.event.mentions;
  if (!mentions.length) return;
  let target = mentions[0].id;
  let user = userRegistry.getUser(target);
  let globalUrl = resolveUserAvatar(user, null, 512);
  let guildUrl;
  if (user.guildMemberAvatars[ctx.guild?.id]) {
    guildUrl = resolveUserAvatar(user, ctx.guild?.id, 512);
  }
  let reply = 'Global URL: ' + globalUrl.href;
  if (guildUrl) reply += '\nGuild URL: ' + guildUrl.href;
  await ctx.reply({ content: reply });
});
registerExternalCommand('wa', async ctx => {
  // TODO: discord no longer allows non-bot users to send embeds, fix this
  await ctx.reply({ content: 'can no longer send embeds, wolframalpha requires refactoring' });
  return;

  let query = ctx.sliceRawArgs(1).replace(/\n/g, ' ');
  let user = ctx.source;
  let avatarURL = resolveUserAvatar(user, ctx.guild?.id, 64).href;
  let username = user.username;
  let displayedQuery = query;
  if (query.length > 100) displayedQuery = query.slice(0, 100) + '...';
  let sent = null;
  let queryUrl = new URL('https://www.wolframalpha.com/input');
  queryUrl.searchParams.set('i', query);
  let embed = {
    author: {
      name: 'WolframAlpha: ' + displayedQuery,
      url: queryUrl.href,
      icon_url: 'https://hellomouse.net/static/wolframalpha.png'
    },
    title: '[iczero cannot write code]',
    description: '[insert funny placeholder text here]',
    timestamp: (new Date()).toISOString(),
    footer: {
      icon_url: avatarURL,
      text: username
    },
    color: 0x000000
  };
  let updateLoadState = async (text, color) => {
    embed.title = text;
    embed.description = randomArrayElement(WOLFRAMALPHA_LOADING_MESSAGES);
    embed.timestamp = (new Date()).toISOString();
    embed.color = color;
    if (sent) await editMessage(ctx.channel.id, messageId, { embed, ...REPLY_NO_PING });
  };
  if (wolframAlphaQueryLock.canAcquire()) updateLoadState('Running...', 0x2decfa);
  else updateLoadState('waiting for semaphore', 0xffff00);
  let promise = wolframAlphaQueryLock.execute(async () => {
    updateLoadState('Running...', 0x2decfa);
    return await inject.wolframAlphaQuery(query);
  });
  sent = await ctx.reply({ embed });
  let messageId = sent.body.id;

  let response = null;
  let responseError = null;
  try {
    response = await promise;
    log('wolframalpha response:', response);
  } catch (err) {
    responseError = err;
    log('wolframalpha query error:', err);
  }

  let baseMessageLength = embed.author.name.length + username.length;
  process: {
    embed.title = null;

    if (responseError) {
      embed.title = 'Request error';
      baseMessageLength += embed.title.length;
      embed.description = '```\n' + truncateLinesArray(
        responseError.stack.split('\n'), EMBED_MAX_LENGTH - baseMessageLength - 8
      ) + '\n```';
      embed.color = 0xff0000;
      break process;
    }

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
        // exists, then it is for 25, which is >= the length of what it needs to be now
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

  await editMessage(ctx.channel.id, messageId, { embed, ...REPLY_NO_PING });
});
registerExternalCommand('cross', async ctx => {
  // but why am i doing this
  // todo: lift functions or something idk
  /**
   * Parse genotype
   * @param {string} s
   * @return {{ error: string} | { error: null, split: string[], alleles: string[], gametes: string[] }}
   */
  function parseGenotype(s) {
    if (!s.length) return { error: 'empty genotype' };
    if (s.length % 2) return { error: 'genotype length must be a multiple of 2' };
    /** @type {string} */
    let split = [];
    for (let i = 0; i < s.length; i += 2) split.push(s.slice(i, i + 2));
    /** @type {string} */
    let alleles = [];
    for (let pair of split) {
      if (pair[0].toLowerCase() !== pair[1].toLowerCase()) {
        return { error: `pair ${pair} does not match` };
      }
      alleles.push(pair[0].toLowerCase());
    }
    // abusing binary to generate permutations
    let gametes = new Set();
    for (let select = 0; select < 2 ** split.length; select++) {
      let gamete = [];
      for (let i = 0; i < split.length; i++) {
        gamete.push(split[i][(select >> i) & 1]);
      }
      gametes.add(gamete.join(''));
    }
    return { error: null, split, alleles, gametes: [...gametes] };
  }
  /**
   * Normalize allele pair (aA -> Aa)
   * @param {string[]} s
   */
  function normalizePair(s) {
    if (s[0] === s[0].toUpperCase()) return [s[0], s[1]];
    else return [s[1], s[0]];
  }
  if (ctx.args.length < 3) {
    await ctx.reply({ content: 'must cross 2 things' });
    return;
  }
  let genotype1 = parseGenotype(ctx.args[1]);
  if (genotype1.error) {
    await ctx.reply({ content: 'genotype 1 error: ' + genotype1.error });
    return;
  }
  let genotype2 = parseGenotype(ctx.args[2]);
  if (genotype2.error) {
    await ctx.reply({ content: 'genotype 2 error: ' + genotype2.error });
    return;
  }
  if (Math.max(genotype1.alleles.length, genotype2.alleles.length) > 3) {
    await ctx.reply({ content: 'too many alleles (blame message limit)' });
    return;
  }
  if (!arrayEquals(genotype1.alleles, genotype2.alleles)) {
    await ctx.reply({ content: 'genotype alleles do not match' });
    return;
  }
  let table = new Array(genotype1.gametes.length).fill(null);
  for (let i = 0; i < table.length; i++) {
    table[i] = new Array(genotype2.gametes.length).fill(null);
  }
  /** @type {Map<string, number>} */
  let genotypeFrequencies = new Map();
  let total = genotype1.gametes.length * genotype2.gametes.length;
  for (let row = 0; row < table.length; row++) {
    for (let col = 0; col < table[row].length; col++) {
      let genotype = [];
      for (let i = 0; i < genotype1.alleles.length; i++) {
        genotype.push(normalizePair([genotype1.gametes[row][i], genotype2.gametes[col][i]]).join(''));
      }
      let combined = genotype.join('');
      table[row][col] = combined;
      let freq = genotypeFrequencies.get(combined);
      if (!freq) genotypeFrequencies.set(combined, 1);
      else genotypeFrequencies.set(combined, freq + 1);
    }
  }
  log('polyhybrid:', table, genotypeFrequencies);
  let prettyTable = [];
  let g1 = genotype1.gametes;
  let g2 = genotype2.gametes;
  let al = genotype1.alleles.length;
  // column header
  prettyTable.push(`${' '.repeat(al)} | ${g2.join(' '.repeat(al + 1))}`);
  // separator
  prettyTable.push(`${'-'.repeat(al)}-+-${'-'.repeat((al * 2 + 1) * genotype1.gametes.length)}`);
  // rows
  for (let [i, row] of table.entries()) {
    prettyTable.push(`${g1[i]} | ${row.join(' ')}`);
  }
  let freqInfo = [...genotypeFrequencies]
    .sort(([, v1], [, v2]) => v2 - v1)
    .map(([key, value]) => `${key}: ${value}/${total} (${(value / total * 100).toFixed(2)}%)`)
    .join('\n');
  await ctx.reply({ content: '```\n' + prettyTable.join('\n') + '\n```\n' + freqInfo });
});

async function renderLatex(input, mode) {
  // trim is necessary otherwise latex takes two newlines as \par
  if (mode === 'math') input = `\\[\n${input.trim()}\n\\]`;
  let result = await inject.makeLatexImage(input);
  let blob = new Blob([result.output]);
  if (!result.error) {
    return { file: blob, filename: 'latex.png' };
  } else {
    let errorMessage = new TextDecoder('utf-8').decode(result.output);
    // why can't latex write error messages to different files ;-;
    let errorLines = errorMessage.split('\n');
    let filteredLines = [];
    let foundErrorLine = false;
    let includeNextLine = false;
    for (let line of errorLines) {
      // usually begins error messages
      if (line.startsWith('! ')) {
        foundErrorLine = true;
        filteredLines.push(line);
      } else if (foundErrorLine) {
        if (includeNextLine) {
          filteredLines.push(line);
          includeNextLine = false;
        } else if (line.startsWith('l.')) {
          includeNextLine = true;
          filteredLines.push(line);
        } else if (!line.length) {
          foundErrorLine = false;
        } else {
          filteredLines.push(line);
        }
      }
    }
    let shortError = '';
    if (filteredLines.length) shortError = '\n```\n' + truncateLinesArray(filteredLines, 1950) + '\n```';
    return { content: 'An error occurred' + shortError, file: blob, filename: 'error.txt' };
  }
}

const LATEX_EDIT_TIMEOUT = 15 * 60 * 1000;
registerExternalCommand('tex', async ctx => {
  let input = ctx.parseCodeblocks(['latex', 'tex'], 1);
  let result = await renderLatex(input, ctx.args[0]);
  let replyMessage = await ctx.reply(result);
  let initialReplyTime = Date.now();
  let editHandler = new MessageUpdateHandler(ctx.channel.id, ctx.event.id, async (event, handler) => {
    if (!event.content.startsWith(PREFIX)) {
      handler.unregister();
      return;
    }
    if (Date.now() < initialReplyTime + LATEX_EDIT_TIMEOUT) handler.resetTimeout();
    await api.delete(Endpoints.MESSAGE(replyMessage.body.channel_id, replyMessage.body.id));
    let ctx2 = new ExtCommandContext(event, ctx.channel);
    let input = ctx2.parseCodeblocks(['latex', 'tex'], 1);
    let result = await renderLatex(input, ctx2.args[0]);
    replyMessage = await ctx.reply(result);
  }, 60 * 1000);
  editHandler.register();
});
registerExternalCommand('math', 'tex');
registerExternalCommand('align', async ctx => {
  if (ctx.args.length < 3) {
    await ctx.reply({ content: 'usage: align protein <fasta>' });
    return;
  }
  let mode = ctx.args[1];
  let input = parseCodeblocks([], 2);
  let result;
  // TODO: make less bad
  if (mode === 'protein' || mode === 'nucleotide') {
    result = await inject.align.mafft(input);
  } else {
    await ctx.reply({ content: 'unknown mode' });
    return;
  }
  await ctx.reply({
    content: '```\n' + result.slice(0, MESSAGE_MAX_LENGTH - 8) + '\n```'
  });
});
registerExternalCommand('random', async ctx => {
  let splitArgs = ctx.args.slice(1).map(a => a.toLowerCase());
  let short = false;
  let decimal = false;
  let encoding = 'hex';
  while (splitArgs.length) {
    switch (splitArgs.pop()) {
      case 'short': short = true; break;
      case 'long': short = false; break;
      case 'hex': decimal = false; encoding = 'hex'; break;
      case 'base64': decimal = false; encoding = 'base64'; break;
      case 'decimal': decimal = true; break;
      default: break;
    }
  }

  let reply = '';
  if (!decimal) {
    let length = 64;
    if (short) length = 8;
    reply = inject.random.read(length, encoding);
  } else {
    let rawState = inject.random.readRaw();
    if (short) rawState = rawState.subarray(0, 2);
    reply = rawState
      .reduce((acc, val, idx) => acc | (BigInt(val) << BigInt(idx * 32)), 0n)
      .toString();
  }
  await ctx.reply({ content: reply });
});
registerExternalCommand('roll', async ctx => {
  let dice = ctx.args.slice(1).map(m => {
    let spec = m.split('d');
    let count;
    if (spec[0].length) count = +spec[0];
    else count = 1;
    let sides = +spec[1];
    if (!Number.isFinite(count) || !Number.isFinite(sides)) return null;
    count = Math.floor(count);
    sides = Math.floor(sides);
    if (count <= 0 || count > 100) return null;
    if (sides < 0 || sides > 1e15) return null;
    return [count, sides];
  }).filter(Boolean).slice(0, 25);
  let output = [];
  let outputLength = 0;
  mainLoop: for (let [count, sides] of dice) {
    let lineHeader = `**${count}d${sides}:** `;
    if (outputLength + lineHeader.length >= MESSAGE_MAX_LENGTH) break;
    let source = inject.random.intMany(count, sides === 0 ? 3 : sides);
    let results = [];
    let lineLength = lineHeader.length;
    for (let pick of source) {
      let result;
      if (sides !== 0) {
        result = pick + 1;
      } else {
        result = [Infinity, NaN, -Infinity][pick];
      }
      let resultString = result.toString();
      let newTotalLength = outputLength + lineLength + resultString.length +
        (output.length ? 1 : 0) + (results.length ? 1 : 0);
      if (newTotalLength > MESSAGE_MAX_LENGTH) {
        output.push(lineHeader + results.join(' '));
        break mainLoop;
      }
      if (results.length) lineLength++;
      results.push(resultString);
      lineLength += resultString.length;
    }
    if (output.length) outputLength++;
    let line = lineHeader + results.join(' ');
    output.push(line);
    outputLength += line.length;
  }
  let content = output.join('\n');
  if (content.length > MESSAGE_MAX_LENGTH) {
    log('command(roll): length over', output, output.map(s => s.length, content.length), content, content.length);
    throw new Error('derp');
  }
  if (!content) {
    if (!dice.length) content = 'invalid syntax, use <count>d<sides> [...]';
    else content = 'too long';
  }
  await ctx.reply({ content });
});
registerExternalCommand('color', async ctx => {
  let canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  let cctx = canvas.getContext('2d');
  let color;
  if (ctx.args.length > 1) color = ctx.args.slice(1).join(' ');
  else color = '#' + inject.random.read(3, 'hex');
  // normalize color
  let testStyle = document.createElement('div').style;
  testStyle.color = color;
  if (!testStyle.color) {
    await ctx.reply({ content: 'invalid color' });
    return;
  }
  cctx.fillStyle = testStyle.color;
  cctx.fillRect(0, 0, canvas.width, canvas.height);
  // webp alters the color slightly
  let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  await ctx.reply({ content: testStyle.color, file: blob, filename: 'blob.png' });
});
registerExternalCommand('uuid', async ctx => {
  // generate v4 uuid
  let count = +ctx.args[1];
  if (Number.isNaN(count) || count < 1) count = 1;
  const LINE_LENGTH = 38; // uuid and backticks
  let out = [];
  let outLength = 0;
  for (let i = 0; i < count; i++) {
    let newLength = outLength + LINE_LENGTH;
    if (out.length) newLength += 1;
    if (newLength > MESSAGE_MAX_LENGTH) break;
    out.push(`\`${uuid()}\``);
    outLength = newLength;
  }
  await ctx.reply({ content: out.join('\n') });
});
/*
registerExternalCommand('eval', async (args, event) => {
  if (event.author.id !== userRegistry.getCurrentUser().id) return;
  let input = parseCodeblocks(args.slice(1).join(' '), ['js']);
  let result;
  try {
    result = eval(input);
  } catch (err) {
    result = err;
  }
  await sendMessage(event.channel_id, {
    content: '```js\n' + inject.inspect(result).slice(0, MESSAGE_MAX_LENGTH - 9) + '```'
  });
});
registerExternalCommand('preloadeval', async (args, event) => {
  if (event.author.id !== userRegistry.getCurrentUser().id) return;
  let input = parseCodeblocks(args.slice(1).join(' '), ['js']);
  let result;
  try {
    result = inject.evalInPreload(input);
  } catch (err) {
    result = err;
  }
  await sendMessage(event.channel_id, {
    content: '```js\n' + inject.inspect(result).slice(0, MESSAGE_MAX_LENGTH - 9) + '```'
  });
});
*/
let feedRandom = (...obj) => inject.random.write(JSON.stringify(obj).slice(1, -1));
gatewayEvents.on('MESSAGE_CREATE', ev => {
  if (ev.application_id) {
    return feedRandom(ev.channel_id, ev.author?.id, ev.application_id, ev.id, ev.content);
  }
  return feedRandom(ev.channel_id, ev.author?.id, ev.id, ev.content);
});
gatewayEvents.on('MESSAGE_UPDATE', ev => feedRandom(ev.channel_id, ev.author?.id, ev.id, ev.content));
gatewayEvents.on('MESSAGE_DELETE', ev => feedRandom(ev.channel_id, ev.id));
gatewayEvents.on('MESSAGE_REACTION_ADD', ev => feedRandom(ev.user_id, ev.channel_id, ev.message_id, ev.emoji?.name, ev.emoji?.id));
gatewayEvents.on('MESSAGE_REACTION_REMOVE', ev => feedRandom(ev.user_id, ev.channel_id, ev.message_id, ev.emoji?.name, ev.emoji?.id));
gatewayEvents.on('VOICE_STATE_UPDATE', ev => feedRandom(ev.user_id, ev.channel_id, ev.session_id, ev.self_deaf, ev.self_mute, ev.self_video));
gatewayEvents.on('CHANNEL_UPDATE', ev => {
  if (ev.parent_id) {
    return feedRandom(ev.id, ev.name, ev.parent_id, ev.last_message_id);
  }
  return feedRandom(ev.id, ev.name, ev.last_message_id);
});
gatewayEvents.on('PRESENCE_UPDATE', ev => feedRandom(ev.user?.id, ev.last_modified, ev.status));
gatewayEvents.on('TYPING_START', ev => feedRandom(ev.channel_id, ev.user_id));

async function runCommand(ctx) {
  log('command:', ctx.args[0], ctx);
  let fn = externalCommands.get(ctx.args[0].toLowerCase());
  if (fn) fn(ctx);
}

/**
 * Split message, assumes valid command with prefix
 * @param {string} content
 * @return {string[]}
 */
function splitCommandMessage(content) {
  let messageSplit = content.split(' ');
  let args = [messageSplit[0].slice(PREFIX.length), ...messageSplit.slice(1)];
  return args;
}

const RANDOM_SYNC_CHANNEL = inject.config.randomSyncChannel;

gatewayEvents.on('MESSAGE_CREATE', async event => {
  if (!enableCommands) return;
  let channel = channelRegistry.getChannel(event.channel_id);
  if (!channel) return;

  // listen to sync requests from RANDOM_SYNC_CHANNEL
  if (event.channel_id === RANDOM_SYNC_CHANNEL) {
    if (event.content.includes('!do-random-sync')) {
      await sendMessage(event.channel_id, {
        content: '!random-sync ' + inject.random.read(64, 'base64')
      });
    }
  }

  // handle commands
  if (!event.content.startsWith(PREFIX)) return;
  let args = splitCommandMessage(event.content);

  let commandsAllowedKey;
  switch (channel.type) {
    case ChannelTypes.GUILD_TEXT:
    case ChannelTypes.PRIVATE_THREAD:
    case ChannelTypes.PUBLIC_THREAD:
      commandsAllowedKey = 'guild:' + event.guild_id;
      break;

    case ChannelTypes.DM:
      commandsAllowedKey = 'userDM:' + channel.getRecipientId();
      break;

    default:
      return;
  }
  if (!COMMANDS_ALLOWED.has(commandsAllowedKey)) {
    if (!ALLOWED_GUILDS_EXEMPT.has(args[0].toLowerCase())) return;
  }

  let ctx = new ExtCommandContext(event, channel);

  try {
    runCommand(ctx);
  } catch (err) {
    log('error running command!', ctx, err);
  }
});
