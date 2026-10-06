(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.pluginRegistry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // A controlled development fixture. This registry grants no rights to other videos.
  const lessons = [
    { id: 'pilot-triangle-3-4-5', path: '/extension/assets/video/geometry/triangle-3-4-5.mp4', duration: 12,
      title: '自制直角三角形 3–4–5' },
    { id: 'pilot-parabola', path: '/extension/assets/video/breakglass-demo-9s.mp4', duration: 9.375,
      title: '项目抛物线演示' }
  ];
  function findLesson(id) { return lessons.find((lesson) => lesson.id === id) || null; }
  function sourceFor(lesson) {
    return { kind: 'visual-session', id: lesson.id, version: '1', analysisVersion: '1',
      title: lesson.title, materialMode: 'self-authored' };
  }
  return { lessons, findLesson, sourceFor };
});
