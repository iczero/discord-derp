# discord-derp

it's like discord but *worse*

## how to use

1. find the discord data folder. it should contain a directory structure
    something like `0.0.17/modules/discord_desktop_core`. on Linux, this is in
    `~/.config/discord`.
1. replace the contents of `<version>/modules/discord_desktop_core/index.js`
    with `module.exports = require('/absolute/path/to/inject.js');`
1. restart discord. note: these steps sometimes need to be redone after updates.

configuration options can be set in `config.toml`, see `config-example.toml`.

custom css can be defined, see `custom-example.css`.

## random stuff

documentation is hard

### file organization

- `inject.js` contains the script injected into the electron main process. it
    monkeypatches electron so stuff can be done.
- `inject-preload.js` contains the script injected into the electron renderer
    process preload environment. it has access to node.js modules.
- `inject-renderer.js` is injected by `inject-preload.js` into the web frame.
    it does not have access to node.js modules.
- `keccak.ts` is an implementation of keccak. it is used for ~~CRYPTOGRAPHICALLY
    SECURE~~ memes.
- `derp.js` contains random fragments of code.
- `config.toml` contains a bit of configuration for the thing.
- `custom.css` allows to override discord css.
- `latex/` contains everything needed to render $\LaTeX$.
- `README.md` contains horrible documentation.

### "features"

- ctrl-click a message to reply. hold shift to ping.
- alt-shift-click a message to edit.
- adblocking, probably kills a few trackers or something
- can inject custom css
- generates cryptographically secure random numbers!
- re-enables devtools
- does NOT steal your token, probably
- preserves context isolation
- keccak!
- bad bioinformatics

### todo

- proper module system, either by moving everything into preload or just
    throwing more scripts into the window
- encryption or something
- IP over Discord
  - something more efficient than base64 (CJK characters are considered one
    character each)
  - fix <https://github.com/hellomouse/node-tunfd>
  - probably best to use ethernet, assign own mac by deriving user id then
    include only dest addr and ethertype in message
  - pack multiple frames into a single message
- something else that i've since forgot about
