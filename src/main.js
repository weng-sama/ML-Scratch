import './styles.css';
import { api, connect, watchJob } from './api.js';
import { t } from './i18n/index.js';
import * as graph from './graph.js';
import { clearBlocks, initBlocks, loadBlocks, saveBlocks } from './blocks.js';
import { Runtime } from './runtime.js';
import { createPreview } from './panels/preview.js';
import { createTrainPanel } from './panels/train.js';
import { createAnnotator } from './panels/annotate.js';

const PROJECT_VERSION = 1;
const AUTOSAVE_KEY = 'ml-scratch:autosave';
const $ = (sel) => document.querySelector(sel);

function toast(msg) {
  const el = Object.assign(document.createElement('div'), { className: 'toast', textContent: msg });
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 5000);
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-page').forEach((p) => { p.hidden = p.dataset.tab !== name; });
}

// ---------- 專案 ----------

function serialize() {
  return JSON.stringify({ version: PROJECT_VERSION, graph: graph.exportGraph(), blocks: saveBlocks() });
}

function load(json) {
  const data = JSON.parse(json);
  graph.clearGraph();
  graph.importGraph(data.graph);
  clearBlocks();
  if (data.blocks) loadBlocks(data.blocks);
  refreshNodeStatuses();
}

function defaultProject() {
  graph.clearGraph();
  clearBlocks();
  const cam = graph.addNode('camera', 40, 220);
  const pre = graph.addNode('pretrained', 40, 40, { title: `${t('node.pretrained.title')}1`, key: 'yolo11n' });
  const pred = graph.addNode('predict', 340, 110);
  graph.connect(pre, pred, 1);
  graph.connect(cam, pred, 2);
  const text = (s) => ({ shadow: { type: 'text', fields: { TEXT: s } } });
  loadBlocks({
    blocks: {
      languageVersion: 0,
      blocks: [{
        type: 'ml_when_result', x: 30, y: 30, fields: { NODE: String(pred) },
        next: { block: {
          type: 'controls_if',
          inputs: {
            IF0: { block: { type: 'logic_compare', fields: { OP: 'GT' }, inputs: {
              A: { block: { type: 'ml_count_of', inputs: { LABEL: text('person') } } },
              B: { block: { type: 'math_number', fields: { NUM: 0 } } },
            } } },
            DO0: { block: { type: 'ml_say', inputs: { TEXT: text('看到人了！') } } },
          },
        } },
      }],
    },
  });
}

function autosave() {
  try { localStorage.setItem(AUTOSAVE_KEY, serialize()); } catch { /* 儲存空間不可用時略過 */ }
}

// ---------- 節點動作 ----------

function refreshNodeStatuses() {
  for (const n of graph.nodesOfType('train')) {
    if (n.data.modelId) graph.setStatus(n.id, t('node.train.done', { id: n.data.modelId }), 'done');
    else graph.setStatus(n.id, t('node.train.idle'));
  }
  api.llmModels().then((models) => {
    for (const n of graph.nodesOfType('llm')) {
      const ok = models.find((m) => m.key === n.data.model)?.downloaded;
      graph.setStatus(n.id, t(ok ? 'node.llm.ready' : 'node.llm.notReady'), ok ? 'done' : '');
    }
  }).catch(() => {});
}

function datasetOf(node) {
  const name = (node.data.name || '').trim();
  if (!name) throw new Error(t('graphErr.datasetName'));
  return { name, task: node.data.task };
}

async function startTraining(nodeId, trainPanel) {
  const node = graph.getNode(nodeId);
  const dsNode = graph.inputNode(node, 1);
  const preNode = graph.inputNode(node, 2);
  if (!dsNode) throw new Error(t('graphErr.needDataset', { node: node.data.title }));
  if (!preNode) throw new Error(t('graphErr.needPretrained', { node: node.data.title }));
  const ds = datasetOf(dsNode);
  await api.createDataset(ds.name, ds.task);
  const job = await api.train(ds.name, preNode.data.key, Number(node.data.epochs) || 10);
  trainPanel.addJob(job.id, { dataset: ds.name, task: ds.task });
  switchTab('train');
  graph.setStatus(nodeId, t('node.train.running', { epoch: 0, epochs: node.data.epochs }), 'running');
  watchJob(job.id, (ev) => {
    trainPanel.onEvent(job.id, ev);
    if (ev.type === 'epoch') {
      graph.setStatus(nodeId, t('node.train.running', { epoch: ev.epoch, epochs: ev.epochs }), 'running');
    } else if (ev.type === 'done') {
      graph.updateData(nodeId, { modelId: ev.result.id, modelTask: ev.result.task });
      graph.setStatus(nodeId, t('node.train.done', { id: ev.result.id }), 'done');
      autosave();
    } else if (ev.type === 'error' || ev.type === 'cancelled') {
      graph.setStatus(nodeId, t('node.train.error'), 'error');
      if (ev.msg) toast(ev.msg);
    }
  });
}

async function downloadLLM(nodeId) {
  const node = graph.getNode(nodeId);
  const job = await api.llmDownload(node.data.model);
  watchJob(job.id, (ev) => {
    if (ev.type === 'download') graph.setStatus(nodeId, t('node.llm.downloading', { pct: ev.pct }), 'running');
    else if (ev.type === 'done') refreshNodeStatuses();
    else if (ev.type === 'error') { graph.setStatus(nodeId, t('node.llm.notReady'), 'error'); toast(ev.msg); }
  });
}

// ---------- 啟動 ----------

async function boot() {
  let system;
  try {
    system = await connect();
  } catch (err) {
    $('#status').textContent = t('app.backendDown', { msg: err.message });
    $('#status').classList.add('error');
    return;
  }
  $('#status').textContent = t('app.device', { name: system.name });

  const [pretrained, llms] = await Promise.all([api.pretrained(), api.llmModels()]);
  graph.initGraph($('#graph'), { pretrained, llms });
  initBlocks($('#blockly'));

  const preview = createPreview($('[data-tab="preview"].tab-page'), { onText: (text) => runtime.userText(text) });
  const trainPanel = createTrainPanel($('[data-tab="train"].tab-page'));
  const annotator = createAnnotator($('[data-tab="annotate"].tab-page'), { notify: toast });
  const runtime = new Runtime({
    ...preview,
    error: (msg) => { preview.error(msg); toast(msg); },
    setRunning: (on) => {
      document.body.classList.toggle('running', on);
      $('#btn-start').disabled = on;
    },
  });

  graph.on('action', async (action, nodeId, msg) => {
    try {
      if (action === 'error') toast(msg);
      else if (action === 'annotate') {
        const ds = datasetOf(graph.getNode(nodeId));
        switchTab('annotate');
        await annotator.open(ds.name, ds.task);
      } else if (action === 'train') await startTraining(nodeId, trainPanel);
      else if (action === 'download') await downloadLLM(nodeId);
    } catch (err) {
      toast(err.message);
    }
  });
  let saveTimer;
  graph.on('change', () => { clearTimeout(saveTimer); saveTimer = setTimeout(autosave, 1000); });

  // 節點清單：拖曳或點擊加入
  for (const type of Object.keys(graph.NODE_TYPES)) {
    const item = Object.assign(document.createElement('div'), {
      className: 'palette-item', draggable: true, textContent: t(`node.${type}.title`),
    });
    item.style.setProperty('--node-color', graph.NODE_TYPES[type].color);
    item.addEventListener('dragstart', (e) => e.dataTransfer.setData('node-type', type));
    item.addEventListener('click', () => {
      const r = $('#graph').getBoundingClientRect();
      graph.addNodeAt(type, r.x + r.width / 2 - 100, r.y + r.height / 3);
    });
    $('#palette-items').append(item);
  }

  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#btn-start').addEventListener('click', () => { preview.reset(); switchTab('preview'); runtime.start(); });
  $('#btn-stop').addEventListener('click', () => runtime.stop());
  $('#btn-new').addEventListener('click', () => {
    if (confirm(t('app.confirmNew'))) { runtime.stop(); defaultProject(); refreshNodeStatuses(); }
  });
  $('#btn-save').addEventListener('click', async () => {
    const path = await window.mlscratch?.saveProject(serialize());
    if (path) toast(t('app.saved', { path }));
  });
  $('#btn-open').addEventListener('click', async () => {
    const json = await window.mlscratch?.openProject();
    if (!json) return;
    try { runtime.stop(); load(json); } catch (err) { toast(t('app.loadFailed', { msg: err.message })); }
  });
  if (!window.mlscratch) ['#btn-save', '#btn-open'].forEach((s) => { $(s).hidden = true; });

  let restored = false;
  try {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (saved) { load(saved); restored = true; }
  } catch { /* 自動儲存損毀時改用預設專案 */ }
  if (!restored) defaultProject();
  refreshNodeStatuses();
  setInterval(autosave, 10000);
  window.addEventListener('beforeunload', autosave);
}

function applyStaticText() {
  document.title = t('app.title');
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
}

applyStaticText();
boot();
