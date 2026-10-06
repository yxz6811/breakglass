const video = document.querySelector('video');
document.querySelector('#lesson').addEventListener('change', (event) => {
  video.pause();
  video.src = event.target.value === 'triangle' ? '../extension/assets/video/geometry/triangle-3-4-5.mp4' : '../extension/assets/video/breakglass-demo-9s.mp4';
  video.load();
});
