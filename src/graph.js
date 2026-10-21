// 節點拉線編輯器（Drawflow）：定義節點種類、連線型別檢查與圖形查詢
import Drawflow from 'drawflow';
import 'drawflow/dist/drawflow.min.css';
import { t } from './i18n/index.js';
import { icon } from './icons.js';

// 每種節點：輸入埠可接受的型別、輸出型別、顏色
export const NODE_TYPES = {
  // 顏色與白字對比皆 ≥ 4.5:1（WCAG AA）
  dataset: { inputs: [], output: 'dataset', color: '#2563eb' },
  pretrained: { inputs: [], output: 'model', color: '#7c3aed' },
  train: { inputs: [['dataset'], ['model']], output: 'model', color: '#c2410c' },
  camera: { inputs: [], output: 'image', color: '#15803d' },
  textin: { inputs: [], output: 'text', color: '#0e7490' },
  predict: { inputs: [['model'], ['image', 'text']], output: null, color: '#be123c' },
  llm: { inputs: [['text']], output: null, color: '#0f766e' },
};

const INPUT_LABELS = {
  train: ['port.dataset', 'port.model'],
  predict: ['port.model', 'port.source'],
  llm: ['port.text'],
};

let editor;
let pretrainedList = [];
let llmList = [];
const listeners = { action: [], change: [] };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const opt = (value, label) => `<option value="${esc(value)}">${esc(label)}</option>`;

function nodeHtml(type) {
  const head = `<div class="node-title"><input class="title-input" aria-label="${t('node.rename')}" df-title></div>`;
  const row = (label, field) => `<label class="node-row"><span>${label}</span>${field}</label>`;
  switch (type) {
    case 'dataset':
      return head + row(t('node.dataset.name'), '<input df-name>')
        + row(t('node.dataset.task'), `<select df-task>${['image_cls', 'detect', 'text_cls'].map((k) => opt(k, t(`task.${k}`))).join('')}</select>`)
        + `<button data-action="annotate">${icon('tag')}<span>${t('node.dataset.annotate')}</span></button>`;
    case 'pretrained':
      return head + row(t('node.pretrained.key'), `<select df-key>${pretrainedList.map((p) => opt(p.key, p.label)).join('')}</select>`);
    case 'train':
      return head + row(t('node.train.epochs'), '<input type="number" min="1" max="300" df-epochs>')
        + `<button data-action="train">${icon('play')}<span>${t('node.train.start')}</span></button>`
        + `<div class="node-status" role="status"></div>`;
    case 'camera':
      return head + `<div class="node-hint">${t('node.camera.hint')}</div>`;
    case 'textin':
      return head + `<div class="node-hint">${t('node.textin.hint')}</div>`;
    case 'predict':
      return head + row(t('node.predict.conf'), '<input type="number" min="0.05" max="0.95" step="0.05" df-conf>')
        + row(t('node.predict.interval'), '<input type="number" min="100" step="100" df-interval>');
    case 'llm':
      return head + row(t('node.llm.model'), `<select df-model>${llmList.map((m) => opt(m.key, m.label)).join('')}</select>`)
        + row(t('node.llm.system'), '<textarea rows="2" df-system></textarea>')
        + `<button data-action="download">${icon('download')}<span>${t('node.llm.download')}</span></button>`
        + `<div class="node-status" role="status"></div>`;
    default:
      return head;
  }
}

function defaultData(type) {
  const base = { title: uniqueTitle(t(`node.${type}.title`)) };
  switch (type) {
    case 'dataset': return { ...base, name: '', task: 'image_cls' };
    case 'pretrained': return { ...base, key: pretrainedList[0]?.key || '' };
    case 'train': return { ...base, epochs: 10, modelId: '', modelTask: '' };
    case 'predict': return { ...base, conf: 0.25, interval: 300 };
    case 'llm': return { ...base, model: llmList[0]?.key || '', system: t('node.llm.defaultSystem') };
    default: return base;
  }
}

function uniqueTitle(prefix) {
  const titles = new Set(allNodes().map((n) => n.data.title));
  for (let i = 1; ; i++) if (!titles.has(`${prefix}${i}`)) return `${prefix}${i}`;
}

function decorate(id) {
  const el = document.getElementById(`node-${id}`);
  const node = getNode(id);
  if (!el || !node) return;
  el.style.setProperty('--node-color', NODE_TYPES[node.name]?.color || '#888');
  (INPUT_LABELS[node.name] || []).forEach((key, i) => {
    el.querySelector(`.inputs .input_${i + 1}`)?.setAttribute('data-label', t(key));
  });
  const out = NODE_TYPES[node.name]?.output;
  if (out) el.querySelector('.outputs .output_1')?.setAttribute('data-label', t(`port.${out}`));
}

export function initGraph(container, { pretrained, llms }) {
  pretrainedList = pretrained;
  llmList = llms;
  editor = new Drawflow(container);
  editor.reroute = true;
  editor.start();

  editor.on('nodeCreated', (id) => { decorate(id); emit('change'); });
  editor.on('nodeRemoved', () => emit('change'));
  editor.on('nodeDataChanged', () => emit('change'));
  editor.on('connectionCreated', (c) => { validateConnection(c); emit('change'); });
  editor.on('connectionRemoved', () => emit('change'));

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    const nodeEl = e.target.closest('.drawflow-node');
    if (btn && nodeEl) emit('action', btn.dataset.action, Number(nodeEl.id.replace('node-', '')));
  });

  // 從節點清單拖曳進畫布
  container.addEventListener('dragover', (e) => e.preventDefault());
  container.addEventListener('drop', (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('node-type');
    if (type) addNodeAt(type, e.clientX, e.clientY);
  });
  return editor;
}

export function addNodeAt(type, clientX, clientY) {
  const rect = editor.precanvas.getBoundingClientRect();
  const x = (clientX - rect.x) / editor.zoom;
  const y = (clientY - rect.y) / editor.zoom;
  return addNode(type, x, y);
}

export function addNode(type, x, y, data) {
  const def = NODE_TYPES[type];
  return editor.addNode(type, def.inputs.length, def.output ? 1 : 0, x, y, type, data || defaultData(type), nodeHtml(type));
}

export function connect(fromId, toId, inputIndex) {
  editor.addConnection(fromId, toId, 'output_1', `input_${inputIndex}`);
}

function validateConnection({ output_id, input_id, output_class, input_class }) {
  const from = getNode(output_id);
  const to = getNode(input_id);
  const idx = Number(input_class.split('_')[1]) - 1;
  const accepts = NODE_TYPES[to.name].inputs[idx] || [];
  if (!accepts.includes(NODE_TYPES[from.name].output)) {
    editor.removeSingleConnection(output_id, input_id, output_class, input_class);
    emit('action', 'error', null, t('graphErr.typeMismatch', { from: from.data.title, to: to.data.title }));
    return;
  }
  // 每個輸入埠只保留最新的一條線
  for (const c of [...to.inputs[input_class].connections]) {
    if (String(c.node) !== String(output_id)) editor.removeSingleConnection(c.node, input_id, c.input, input_class);
  }
}

export function on(name, fn) { listeners[name].push(fn); }
function emit(name, ...args) { listeners[name].forEach((fn) => fn(...args)); }

export function getNode(id) { return editor.getNodeFromId(id); }

export function allNodes() {
  if (!editor) return [];
  return Object.values(editor.export().drawflow.Home.data);
}

export function nodesOfType(type) { return allNodes().filter((n) => n.name === type); }

// 取得某個輸入埠接上的來源節點
export function inputNode(node, index) {
  const conns = node.inputs?.[`input_${index}`]?.connections || [];
  return conns.length ? getNode(conns[0].node) : null;
}

// 取得某節點輸出接到的所有目標節點
export function outputNodes(node) {
  const conns = node.outputs?.output_1?.connections || [];
  return conns.map((c) => getNode(c.node));
}

export function updateData(id, patch) {
  const node = getNode(id);
  editor.updateNodeDataFromId(id, { ...node.data, ...patch });
}

export function setStatus(id, text, state = '') {
  const el = document.querySelector(`#node-${id} .node-status`);
  if (el) {
    el.textContent = text;
    el.dataset.state = state;
  }
  // 執行中時停用節點上的動作按鈕，避免重複送出
  const btn = document.querySelector(`#node-${id} button[data-action]`);
  if (btn) btn.disabled = state === 'running';
}

export function exportGraph() { return editor.export(); }

export function importGraph(data) {
  editor.import(data);
  allNodes().forEach((n) => decorate(n.id));
}

export function clearGraph() { editor.clear(); }
