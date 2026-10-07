(function (root) {
  'use strict';
  const bg = root.BreakGlass = root.BreakGlass || {};
  // Static repository markup is imported once. Each controller sees only its own IDs.
  function namespace(container, prefix) {
    const ids = new Map();
    container.querySelectorAll('[id]').forEach((node) => {
      const original = node.id; ids.set(original, `${prefix}-${original}`);
      node.dataset.bgId = original; node.id = ids.get(original);
    });
    container.querySelectorAll('*').forEach((node) => {
      for (const name of ['for', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'data-dock-reveal']) {
        if (node.hasAttribute(name)) node.setAttribute(name, node.getAttribute(name).split(/\s+/).map((id) => ids.get(id) || id).join(' '));
      }
      for (const name of ['href', 'filter']) {
        const value = node.getAttribute(name);
        if (value?.startsWith('#') && ids.has(value.slice(1))) node.setAttribute(name, `#${ids.get(value.slice(1))}`);
        if (value?.startsWith('url(#')) { const id = value.slice(5, -1); if (ids.has(id)) node.setAttribute(name, `url(#${ids.get(id)})`); }
      }
    });
    return ids;
  }
  function createDocument(container, { aliases = {}, prefix = '', document = root.document } = {}) {
    const ids = prefix ? namespace(container, prefix) : new Map();
    const selector = (value) => value.replace(/#([\w-]+)/g, (_, id) => `#${ids.get(id) || id}`);
    return new Proxy(document, { get(target, name) {
      if (name === 'getElementById') return (id) => aliases[id] || container.querySelector(`#${ids.get(id) || id}`);
      if (name === 'querySelector') return (query) => { if (/^#[\w-]+$/.test(query) && aliases[query.slice(1)]) return aliases[query.slice(1)]; return container.querySelector(selector(query)); };
      if (name === 'querySelectorAll') return (query) => container.querySelectorAll(selector(query));
      const value = Reflect.get(target, name, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  }
  bg.mountContext = { namespace, createDocument };
})(globalThis);
