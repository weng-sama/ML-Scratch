// 共用的攝影機串流：預覽與標註面板都從這裡取畫面
let stream = null;
const video = document.createElement('video');
video.muted = true;
video.playsInline = true;

export async function ensureCamera() {
  if (!stream) {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    video.srcObject = stream;
    await video.play();
  }
  return stream;
}

export function attach(el) {
  el.srcObject = stream;
  el.muted = true;
  el.play().catch(() => {});
}

// 擷取目前畫面為 JPEG data URL
export function grabFrame(maxSide = 640) {
  if (!stream || !video.videoWidth) return null;
  const s = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(video.videoWidth * s);
  c.height = Math.round(video.videoHeight * s);
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}
