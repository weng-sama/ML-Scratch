// 介面圖示：路徑由 scripts/build-icons.mjs 從 Lucide 產生；一律 aria-hidden，文字標籤另外提供
import { PATHS } from './icon-paths.js';

export function icon(name, size = 16) {
  if (!PATHS[name]) throw new Error(`未定義的圖示：${name}（請加到 scripts/build-icons.mjs）`);
  return `<svg class="icon" aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`;
}

// 建立「圖示＋文字」按鈕；只有圖示時必須給 label 作為 aria-label
export function iconButton(name, text, { label, className = '' } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.innerHTML = icon(name) + (text ? `<span>${text.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`)}</span>` : '');
  if (!text) btn.setAttribute('aria-label', label);
  if (label) btn.title = label;
  return btn;
}
