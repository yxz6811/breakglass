/* Showcase event ownership, within docs/BreakGlass-constitution.md.
   Older WebKit exposes MediaQueryList.addListener and ignores listener signals. */
(function () {
  'use strict';
  window.BreakGlassMotion = {
    createListeners: function () {
      var removers = [];
      var disposed = false;
      return {
        listen: function (target, type, callback, options) {
          if (disposed) return;
          if (typeof target.addEventListener === 'function') {
            target.addEventListener(type, callback, options);
            removers.push(function () { target.removeEventListener(type, callback, options); });
          } else if (type === 'change' && typeof target.addListener === 'function') {
            target.addListener(callback);
            removers.push(function () { target.removeListener(callback); });
          }
        },
        abort: function () {
          if (disposed) return;
          disposed = true;
          removers.forEach(function (remove) { remove(); });
          removers = [];
        }
      };
    }
  };
}());
