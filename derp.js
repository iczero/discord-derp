// random stuff that ought not to be committed but i'd forget otherwise

// style ambiguator
let allClasses = [...document.querySelector('head > link[rel="stylesheet"]').sheet.rules]
  .filter(a => a instanceof CSSStyleRule)
  .map(a => a.selectorText)
  .map(a => [...a.matchAll(/\.(\w+)-(\w{6})/g)])
  .filter(Boolean)
  .flat()
  .map(a => a.slice(1));
let classMap = new Map();
for (let [name, id] of allClasses) {
  let arr = classMap.get(name);
  if (!arr) {
    arr = [id];
    classMap.set(name, arr)
  } else arr.push(id);
}
