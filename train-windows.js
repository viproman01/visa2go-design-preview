/** Mirror the single decoded video frame into both side windows. */
export function synchronizeTrainWindows(video, canvases) {
  const surfaces = [...canvases].map(canvas => ({
    canvas,
    context: canvas.getContext('2d', { alpha: false }),
    width: 0,
    height: 0,
  })).filter(surface => surface.context);
  const masterWindow = video.parentElement;
  const useVideoFrames = typeof video.requestVideoFrameCallback === 'function'
    && typeof video.cancelVideoFrameCallback === 'function';
  let pendingFrame = null;
  let hasPresentedFrame = video.currentTime > 0;
  let masterWidth = 0;
  let masterHeight = 0;

  function drawFrame() {
    if (!hasPresentedFrame || video.readyState < 2 || !video.videoWidth
      || !masterWidth || !masterHeight) return;

    // Match the center window's object-fit: cover and object-position: 48%.
    // A shared scale keeps the horizon and landscape speed aligned.
    const scale = Math.max(masterWidth / video.videoWidth, masterHeight / video.videoHeight);
    const sourceHeight = Math.min(video.videoHeight, masterHeight / scale);
    const sourceY = (video.videoHeight - sourceHeight) * 0.48;
    for (const surface of surfaces) {
      if (!surface.width || !surface.height) continue;
      const sourceWidth = Math.min(video.videoWidth, surface.width / scale);
      const sourceX = surface.canvas.dataset.side === 'right' ? video.videoWidth - sourceWidth : 0;
      surface.context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight,
        0, 0, surface.canvas.width, surface.canvas.height);
      // Until the first actual video frame, the static poster stays visible.
      if (surface.canvas.dataset.ready !== 'true') surface.canvas.dataset.ready = 'true';
    }
  }

  function stopFrames() {
    if (pendingFrame === null) return;
    if (useVideoFrames) video.cancelVideoFrameCallback(pendingFrame);
    else cancelAnimationFrame(pendingFrame);
    pendingFrame = null;
  }

  function queueFrame() {
    if (pendingFrame !== null || video.paused || video.ended || document.hidden
      || !surfaces.some(surface => surface.width && surface.height)) return;
    pendingFrame = useVideoFrames
      ? video.requestVideoFrameCallback(presentFrame)
      : requestAnimationFrame(presentFrame);
  }

  function presentFrame() {
    pendingFrame = null;
    if (document.hidden) return;
    hasPresentedFrame = true;
    drawFrame();
    queueFrame();
  }

  function resize() {
    const rect = masterWindow.getBoundingClientRect();
    masterWidth = rect.width;
    masterHeight = rect.height;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    for (const surface of surfaces) {
      const rect = surface.canvas.parentElement.getBoundingClientRect();
      surface.width = rect.width;
      surface.height = rect.height;
      if (!rect.width || !rect.height) continue;
      const width = Math.max(1, Math.round(rect.width * pixelRatio));
      const height = Math.max(1, Math.round(rect.height * pixelRatio));
      // Resizing clears a canvas: do it only when its dimensions change.
      if (surface.canvas.width !== width) surface.canvas.width = width;
      if (surface.canvas.height !== height) surface.canvas.height = height;
    }
    drawFrame();
    if (surfaces.some(surface => surface.width && surface.height)) queueFrame();
    else stopFrames();
  }

  video.addEventListener('play', queueFrame);
  video.addEventListener('playing', () => {
    hasPresentedFrame = true;
    drawFrame();
    queueFrame();
  });
  video.addEventListener('loadeddata', queueFrame);
  video.addEventListener('loadedmetadata', resize);
  video.addEventListener('pause', () => { stopFrames(); drawFrame(); });
  video.addEventListener('ended', () => { stopFrames(); drawFrame(); });
  video.addEventListener('seeking', stopFrames);
  video.addEventListener('seeked', () => {
    hasPresentedFrame = true;
    drawFrame();
    queueFrame();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopFrames();
    else { drawFrame(); queueFrame(); }
  });
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(resize);
    observer.observe(masterWindow);
    surfaces.forEach(surface => observer.observe(surface.canvas.parentElement));
  }
  window.addEventListener('resize', resize);
  resize();
}
