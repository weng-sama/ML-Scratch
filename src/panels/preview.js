// 預覽面板：攝影機畫面＋偵測框、AI 結果、訊息與對話紀錄、文字輸入
import { attach } from '../camera.js';
import { t } from '../i18n/index.js';
import { icon } from '../icons.js';

export function createPreview(root, { onText }) {
  root.innerHTML = `
    <div class="stage">
      <div class="stage-empty">${t('preview.empty')}</div>
      <video class="stage-video" hidden></video>
      <canvas class="stage-overlay"></canvas>
    </div>
    <div class="results" role="status"></div>
    <div class="log" role="log" aria-live="polite"></div>
    <form class="text-form">
      <input name="text" autocomplete="off" aria-label="${t('preview.inputPlaceholder')}" placeholder="${t('preview.inputPlaceholder')}">
      <button class="primary">${icon('send')}<span>${t('preview.send')}</span></button>
    </form>`;
  const video = root.querySelector('.stage-video');
  const overlay = root.querySelector('.stage-overlay');
  const empty = root.querySelector('.stage-empty');
  const results = root.querySelector('.results');
  const log = root.querySelector('.log');
  const lastResult = new Map();

  root.querySelector('.text-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.target.elements.text;
    const text = input.value.trim();
    if (text) onText(text);
    input.value = '';
  });

  function addLog(cls, text, who) {
    const el = document.createElement('div');
    el.className = `bubble ${cls}`;
    if (who) {
      const w = document.createElement('b');
      w.textContent = `${who}　`;
      el.append(w);
    }
    el.append(text);
    log.append(el);
    while (log.children.length > 200) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }

  function drawBoxes(boxes) {
    const w = video.clientWidth;
    const h = video.clientHeight;
    overlay.width = w;
    overlay.height = h;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 3;
    ctx.font = 'bold 14px sans-serif';
    for (const b of boxes) {
      const x = b.x1 * w;
      const y = b.y1 * h;
      ctx.strokeStyle = '#be123c';
      ctx.strokeRect(x, y, (b.x2 - b.x1) * w, (b.y2 - b.y1) * h);
      const label = `${b.label} ${Math.round(b.conf * 100)}%`;
      ctx.fillStyle = '#be123c';
      ctx.fillRect(x, y - 20, ctx.measureText(label).width + 10, 20);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x + 5, y - 5);
    }
  }

  return {
    showCamera() {
      attach(video);
      video.hidden = false;
      empty.hidden = true;
    },
    showResult(node, res) {
      if (res.task === 'detect') drawBoxes(res.boxes);
      const text = res.label
        ? t('preview.result', { node: node.data.title, label: res.label, conf: Math.round(res.conf * 100) })
        : t('preview.noObject', { node: node.data.title });
      lastResult.set(node.id, text);
      results.replaceChildren(...[...lastResult.values()].map((s) => Object.assign(document.createElement('div'), { textContent: s })));
    },
    say: (text) => addLog('say', text),
    chat: (role, text, who) => addLog(role, text, role === 'assistant' ? who : null),
    error: (text) => addLog('error', text),
    clearLog: () => log.replaceChildren(),
    reset() {
      lastResult.clear();
      results.replaceChildren();
      overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
    },
  };
}
