{
  let defineWindowProperty = (key, value) => Object.defineProperty(window, key, {
    configurable: false,
    enumerable: false,
    writable: false,
    value
  });
  let earlyConsole = window.console;
  let logConsole = earlyConsole.log.bind(earlyConsole, 'inject-renderer-early:');

  let exports = Object.create(null);
  defineWindowProperty('_earlyExports', exports);
  exports.console = earlyConsole;

  // create log overlay
  let logOverlayContainer = document.createElement('div');
  logOverlayContainer.style.display = 'block';
  logOverlayContainer.style.position = 'fixed';
  logOverlayContainer.style.left = 0;
  logOverlayContainer.style.top = 0;
  logOverlayContainer.style.width = '100%';
  logOverlayContainer.style.height = '100%';
  logOverlayContainer.style.overflow = 'hidden';
  logOverlayContainer.style.pointerEvents = 'none';
  // this is probably enough
  logOverlayContainer.style.zIndex = 1e9;
  let logOverlay = document.createElement('div');
  logOverlay.style.display = 'inline';
  logOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  logOverlay.style.color = 'white';
  logOverlay.style.fontFamily = 'monospace';
  logOverlay.style.whiteSpace = 'pre-wrap';
  logOverlayContainer.appendChild(logOverlay);
  exports.logOverlayContainer = logOverlayContainer;
  exports.logOverlay = logOverlay;

  function appendEarlyLog(str) {
    let textNode = document.createTextNode(str + '\n');
    logOverlay.appendChild(textNode);
    logOverlay.scrollIntoView({ block: 'end' });
  }
  exports.appendEarlyLog = appendEarlyLog;

  function appendEarlyLogFancy(...args) {
    appendEarlyLog(args.join(' '));
  }
  exports.appendEarlyLogFancy = appendEarlyLogFancy;

  let log = (...args) => {
    logConsole(...args);
    appendEarlyLogFancy('inject-renderer-early:', ...args);
  };

  log('hello');

  // capture errors
  window.addEventListener('error', event => {
    // no idea what this is but it isn't very useful
    if (event?.message === 'ResizeObserver loop limit exceeded') return;
    appendEarlyLog(`===== ERROR =====`);
    appendEarlyLog(`${event.type}: ${event.message}`);
    if (event.error?.stack) {
      appendEarlyLog(`Full stack trace:`);
      appendEarlyLog(`${event.error.stack}`);
    }
    appendEarlyLog(`=================`);
  })

  function documentHtmlLoadHandler() {}
  function documentHeadLoadHandler() {}
  function documentBodyLoadHandler() {
    document.body.appendChild(logOverlayContainer);
  }

  // at this point, document.documentElement does not exist yet and we can't
  // create it. what we can do, however, is wait for it to exist
  let observedElements = new Map();
  let documentObserver = new MutationObserver(records => {
    for (let record of records) {
      if (record.target === document) {
        for (let node of record.addedNodes) {
          if (node instanceof HTMLHtmlElement) {
            if (!observedElements.has('html')) {
              observedElements.set('html', node);
              log('observed existence of html element');
              documentHtmlLoadHandler();
            }
          }
        }
      } else if (record.target === observedElements.get('html')) {
        for (let node of record.addedNodes) {
          if (node instanceof HTMLHeadElement) {
            if (!observedElements.has('head')) {
              observedElements.set('head', node);
              log('observed existence of head element');
              documentHeadLoadHandler();
            }
          } else if (node instanceof HTMLBodyElement) {
            if (!observedElements.has('body')) {
              observedElements.set('body', node);
              log('observed existence of body element');
              documentBodyLoadHandler();
              // disconnect observer so we don't destroy performance more than
              // discord already does
              documentObserver.disconnect();
            }
          }
        }
      }
    }
  });
  documentObserver.observe(document, { subtree: true, childList: true });

  // intercept and proxy all webpack chunks
  let webpackChunks = [];
  Object.defineProperty(window, 'webpackChunkdiscord_app', {
    configurable: false,
    enumerable: true,
    get() {
      return webpackChunks;
    },
    set(_val) {
      // do nothing
      return;
    }
  });

  let webpackJsonpCallbackPush = null;
  let webpackJsonpDidSetup = false;
  let webpackJsonpEarlyChunks = [];
  let webpackRequire = null;
  let moduleProxyHandlers = new Map();
  let redirectedModules = new Map();
  let moduleRedirectProxyHandlers = new Map();
  let moduleOriginalExports = new Map();
  let poisonedExports = new Set();

  const PROXY_HANDLER_ACTIONS = [
    'apply', 'construct', 'defineProperty', 'deleteProperty', 'get',
    'getOwnPropertyDescriptor', 'getPrototypeOf', 'has', 'isExtensible',
    'ownKeys', 'preventExtensions', 'set', 'setPrototypeOf'
  ];
  const PROXY_HANDLERS = new Map();
  // create handlers for each action, to be bound with module id
  for (let action of PROXY_HANDLER_ACTIONS) {
    if (['get', 'set', 'defineProperty'].includes(action)) continue;
    PROXY_HANDLERS.set(action, (moduleId, target, ...args) => {
      let override = moduleProxyHandlers.get(moduleId);
      if (override?.[action]) {
        return override[action](target, ...args);
      } else {
        return Reflect[action](target, ...args);
      }
    });
  }

  // get and set need special handling code because some objects (notably Window)
  // do not behave when receiver is a proxy
  PROXY_HANDLERS.set('get', (moduleId, target, property, receiver) => {
    let override = moduleProxyHandlers.get(moduleId);
    if (override?.get) {
      return override.get(target, property, receiver);
    } else {
      return Reflect.get(target, property);
    }
  });
  PROXY_HANDLERS.set('set', (moduleId, target, property, value, receiver) => {
    let override = moduleProxyHandlers.get(moduleId);
    if (override?.set) {
      return override.set(target, property, value, receiver);
    } else {
      return Reflect.set(target, property, value);
    }
  });
  // record modules with nonconfigurable properties on exports
  PROXY_HANDLERS.set('defineProperty', (moduleId, target, property, descriptor) => {
    let override = moduleProxyHandlers.get(moduleId);
    if (override?.defineProperty) {
      return override.defineProperty(target, property, descriptor);
    } else {
      if (!descriptor.configurable) {
        poisonedExports.add(moduleId);
      }
      return Reflect.defineProperty(target, property, descriptor);
    }
  });

  function createModuleExportsProxy(moduleId, exports) {
    // create proxy object for module exports
    let handler = {};
    for (let [action, unbound] of PROXY_HANDLERS.entries()) {
      handler[action] = unbound.bind(null, moduleId);
    }
    return new Proxy(exports, handler);
  }

  // "redirect proxies" are proxies created on objects that redirect almost all
  // actions to another target. these have different restrictions. notably,
  // proxies on objects with non-configurable properties cannot return different
  // values for said properties. redirect proxies wrap dummy objects and so they
  // can, however, they cannot trap getOwnPropertyDescriptor.
  const REDIRECT_PROXY_HANDLERS = new Map();
  for (let action of PROXY_HANDLER_ACTIONS) {
    REDIRECT_PROXY_HANDLERS.set(action, (moduleId, redirectTarget, proxyTarget, ...args) => {
      let override = moduleRedirectProxyHandlers.get(moduleId);
      if (override?.[action]) {
        return override[action](redirectTarget, proxyTarget, ...args);
      } else {
        return Reflect[action](redirectTarget, ...args);
      }
    })
  }

  function createModuleExportsRedirectProxy(moduleId, exports) {
    let handler = {};
    for (let [action, unbound] of PROXY_HANDLERS.entries()) {
      handler[action] = unbound.bind(null, moduleId, exports);
    }
    return new Proxy(Object.create(null), handler);
  }

  function redirectModule(moduleId) {
    if (redirectedModules.has(moduleId)) {
      return redirectedModules.get(moduleId);
    }
    let exports = moduleOriginalExports.get(moduleId);
    let proxy = createModuleExportsRedirectProxy(moduleId, exports);
    redirectedModules.set(moduleId, proxy);
    return proxy;
  }

  function createModuleProxy(moduleId, module) {
    // trap overwriting of exports
    let proxiedModule = new Proxy(module, {
      get(target, property, value, _receiver) {
        if (property === 'exports') {
          // do we have a redirection?
          let redirection = redirectedModules.get(moduleId);
          if (redirection) {
            return redirection;
          } else {
            return Reflect.get(target, 'exports');
          }
        } else {
          return Reflect.get(target, property);
        }
      },
      set(target, property, value, _receiver) {
        if (property === 'exports') {
          // store original (not proxied) object
          moduleOriginalExports.set(moduleId, value);
          // proxy exports if it is an object
          if (typeof value === 'object' && value !== null || typeof value === 'function') {
            let proxiedExports = createModuleExportsProxy(moduleId, value);
            return Reflect.set(target, 'exports', proxiedExports);
          } else {
            return Reflect.set(target, 'exports', value);
          }
        } else {
          return Reflect.set(target, property, value);
        }
      },
      defineProperty(target, property, descriptor) {
        if (property === 'exports') {
          // we don't handle this currently
          log('createModuleProxy: warning: module', moduleId, 'defineProperty exports');
        }
        return Reflect.defineProperty(target, property, descriptor);
      }
    });
    // call the handler
    proxiedModule.exports = {};
    // overwrite __webpack_module_cache__ entry with proxied module
    webpackRequire.c[moduleId] = proxiedModule;
    return proxiedModule;
  }

  // export useful stuff
  exports.webpackInterception = {
    moduleProxyHandlers, redirectedModules, moduleRedirectProxyHandlers, moduleOriginalExports,
    PROXY_HANDLERS, createModuleExportsProxy, REDIRECT_PROXY_HANDLERS, createModuleExportsRedirectProxy,
    createModuleProxy, redirectModule, poisonedExports
  };

  function processWebpackChunk(chunk) {
    // called for each chunk before it is loaded by webpack
    let [chunkIds, modules, runtime] = chunk;
    let wrappedModules = {};
    for (let [id, moduleFn] of Object.entries(modules)) {
      wrappedModules[id] = (module, _exports, require) => {
        // TODO: resolveModules logic, including determining whether a module
        // should be proxied or have its exports replaced entirely
        //module = createModuleProxy(id, module);
        return moduleFn.call(module.exports, module, module.exports, require);
      };
    }
    return [chunkIds, wrappedModules, runtime];
  }

  Object.defineProperty(webpackChunks, 'push', {
    configurable: false,
    enumerable: true,
    get() {
      let initialDidSetup = webpackJsonpDidSetup;
      return chunk => {
        let chunkIds = chunk[0];
        if (!webpackJsonpDidSetup) {
          // push was called before the webpack runtime loaded
          // this usually shouldn't happen, but account for it anyways
          log('webpack chunk loaded before runtime, chunk IDs', chunkIds);
          return webpackJsonpEarlyChunks.push(chunk);
        } else if (!initialDidSetup) {
          // push was (most likely) called by the webpack runtime (webpackJsonpCallback)
          // push to underlying array
          if (chunkIds.includes('_inject')) {
            // don't push the _inject chunk
            return webpackChunks.length;
          }
          return Array.prototype.push.call(webpackChunks, chunk);
        } else {
          // push was called by a chunk after the webpack runtime loaded
          let processed = processWebpackChunk(chunk);
          return webpackJsonpCallbackPush(processed);
        }
      };
    },
    set(val) {
      if (webpackJsonpDidSetup) return;
      webpackJsonpDidSetup = true;
      webpackJsonpCallbackPush = val;
      log('inject-renderer-early: got webpackJsonpCallback');
      // obtain __webpack_require__
      webpackJsonpCallbackPush([['_inject'], {}, r => webpackRequire = r]);
      if (!webpackRequire) {
        throw new Error('inject-renderer-early: unable to obtain __webpack_require__');
      }
      log('inject-renderer-early: got __webpack_require__');
      // give to inject-renderer
      exports.webpackRequire = webpackRequire;
      // process early chunks if any exist
      for (let chunk of webpackJsonpEarlyChunks) {
        webpackChunks.push(chunk);
      }
      webpackJsonpEarlyChunks = null;
    }
  });
}
