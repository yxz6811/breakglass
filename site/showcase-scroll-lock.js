/* Entrance scrolling only; docs/BreakGlass-constitution.md frontend scope. */
(function () {
  'use strict';
  window.BreakGlassMotion.createScrollLock = function () {
    var root = document.documentElement;
    var locked = false, disposed = false, listeners = null;
    var position = { x: 0, y: 0 };
    var saved = [];
    var properties = ['--intro-scroll-x', '--intro-scroll-y', '--intro-scroll-padding'];
    var scrollKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar'];

    function prevent(event) {
      if (event.ctrlKey || (event.touches && event.touches.length > 1)) return;
      event.preventDefault();
    }
    function blockKey(event) {
      var target = event.target;
      if (target && (target.isContentEditable || (target.closest && target.closest('input, textarea, select, [contenteditable], [role="textbox"]')))) return;
      if (scrollKeys.indexOf(event.key) !== -1) event.preventDefault();
    }
    function blockAnchor(event) {
      var target = event.target;
      var link = target && target.closest && target.closest('a[href]');
      if (!link) return;
      var url = new URL(link.getAttribute('href'), window.location.href);
      var current = window.location;
      if (url.hash && url.origin === current.origin && url.pathname === current.pathname && url.search === current.search) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    function lock() {
      if (locked || disposed) return;
      position = { x: window.scrollX || 0, y: window.scrollY || 0 };
      var gap = Math.max(0, window.innerWidth - root.clientWidth);
      var padding = parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
      saved = properties.map(function (name) {
        return { name: name, value: root.style.getPropertyValue(name), priority: root.style.getPropertyPriority(name) };
      });
      root.style.setProperty(properties[0], -position.x + 'px');
      root.style.setProperty(properties[1], -position.y + 'px');
      root.style.setProperty(properties[2], padding + gap + 'px');
      root.classList.add('intro-scroll-locked');
      root.dataset.introScroll = 'locked';
      locked = true;
      listeners = window.BreakGlassMotion.createListeners();
      listeners.listen(document, 'wheel', prevent, { passive: false, capture: true });
      listeners.listen(document, 'touchmove', prevent, { passive: false, capture: true });
      listeners.listen(document, 'keydown', blockKey, { capture: true });
      listeners.listen(document, 'click', blockAnchor, { capture: true });
    }
    function unlock() {
      if (!locked) return;
      locked = false;
      listeners.abort();
      listeners = null;
      root.classList.remove('intro-scroll-locked');
      root.dataset.introScroll = 'unlocked';
      saved.forEach(function (property) {
        if (property.value) root.style.setProperty(property.name, property.value, property.priority);
        else root.style.removeProperty(property.name);
      });
      var behavior = root.style.getPropertyValue('scroll-behavior');
      var priority = root.style.getPropertyPriority('scroll-behavior');
      root.style.setProperty('scroll-behavior', 'auto', 'important');
      window.scrollTo(position.x, position.y);
      if (behavior) root.style.setProperty('scroll-behavior', behavior, priority);
      else root.style.removeProperty('scroll-behavior');
    }
    return {
      lock: lock,
      unlock: unlock,
      isLocked: function () { return locked; },
      dispose: function () { unlock(); disposed = true; }
    };
  };
}());
