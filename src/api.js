// 後端 API 用戶端
let base = '';
let token = '';

export async function connect() {
  // Electron 由 preload 提供；瀏覽器開發模式可用 ?backend=http://127.0.0.1:8000&token=xxx
  const info = window.mlscratch ? await window.mlscratch.backendInfo() : null;
  const qs = new URLSearchParams(location.search);
  base = info?.url || qs.get('backend') || 'http://127.0.0.1:8000';
  token = info?.token || qs.get('token') || '';
  return request('GET', '/system');
}

async function request(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-token': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail ?? r.statusText);
    throw new Error(detail);
  }
  return data;
}

const enc = encodeURIComponent;

export const api = {
  pretrained: () => request('GET', '/pretrained'),
  datasets: () => request('GET', '/datasets'),
  createDataset: (name, task) => request('POST', '/datasets', { name, task }),
  dataset: (name) => request('GET', `/datasets/${enc(name)}`),
  setClasses: (name, classes) => request('PUT', `/datasets/${enc(name)}/classes`, { classes }),
  addImage: (name, image, label) => request('POST', `/datasets/${enc(name)}/images`, { image, label }),
  importFolder: (name, path, label) => request('POST', `/datasets/${enc(name)}/import-folder`, { path, label }),
  importCsv: (name, path) => request('POST', `/datasets/${enc(name)}/import-csv`, { path }),
  addText: (name, text, label) => request('POST', `/datasets/${enc(name)}/texts`, { text, label }),
  deleteItem: (name, id) => request('DELETE', `/datasets/${enc(name)}/items/${id}`),
  boxes: (name, id) => request('GET', `/datasets/${enc(name)}/boxes/${id}`),
  setBoxes: (name, id, boxes) => request('PUT', `/datasets/${enc(name)}/boxes/${id}`, { boxes }),
  imageUrl: (name, id) => `${base}/datasets/${enc(name)}/images/${id}?token=${token}`,
  train: (dataset, baseKey, epochs) => request('POST', '/train', { dataset, base: baseKey, epochs }),
  cancelJob: (id) => request('POST', `/jobs/${id}/cancel`),
  predict: (body) => request('POST', '/predict', body),
  llmModels: () => request('GET', '/llm/models'),
  llmDownload: (key) => request('POST', `/llm/download/${key}`),
  llmChat: (model, messages, opts = {}) => request('POST', '/llm/chat', { model, messages, ...opts }),
};

// 訂閱背景工作事件；回傳關閉函式
export function watchJob(jobId, onEvent) {
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws/jobs/${jobId}?token=${token}`);
  ws.onmessage = (e) => onEvent(JSON.parse(e.data));
  return () => ws.close();
}
