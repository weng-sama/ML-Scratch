// 訓練面板：即時繪製 loss 與準確度／mAP 曲線
import { Chart, registerables } from 'chart.js';
import { t } from '../i18n/index.js';
import { iconButton } from '../icons.js';

Chart.register(...registerables);

// 曲線另以虛線區分訓練／驗證，不只靠顏色
const PALETTE = ['#2563eb', '#c2410c', '#7c3aed', '#15803d', '#be123c', '#0f766e'];

function lineChart(canvas, title, yMax) {
  return new Chart(canvas, {
    type: 'line',
    data: { labels: [], datasets: [] },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      plugins: { title: { display: true, text: title }, legend: { position: 'bottom', labels: { boxWidth: 12 } } },
      scales: { x: { title: { display: true, text: 'epoch' } }, y: { beginAtZero: true, max: yMax } },
    },
  });
}

export function createTrainPanel(root, { onCancel }) {
  root.innerHTML = `
    <div class="train-empty">${t('train.empty')}</div>
    <div class="toolbar"><select class="job-select" aria-label="${t('tabs.train')}" hidden></select></div>
    <div class="train-explain"></div>
    <progress class="train-progress" max="1" value="0" hidden></progress>
    <div class="chart-box"><canvas class="loss-chart"></canvas></div>
    <div class="chart-box"><canvas class="metric-chart"></canvas></div>
    <h4>${t('train.log')}</h4>
    <pre class="train-log"></pre>`;
  const select = root.querySelector('.job-select');
  const stopBtn = iconButton('stop', t('train.stopJob'), { className: 'danger' });
  stopBtn.hidden = true;
  stopBtn.addEventListener('click', () => { stopBtn.disabled = true; onCancel(select.value); });
  select.after(stopBtn);
  const progress = root.querySelector('.train-progress');
  const logEl = root.querySelector('.train-log');
  const explain = root.querySelector('.train-explain');
  const lossChart = lineChart(root.querySelector('.loss-chart'), t('train.loss'));
  const metricChart = lineChart(root.querySelector('.metric-chart'), t('train.metric'), 1);
  const jobs = new Map(); // jobId -> { info, task, epochs: [], logs: [], status }

  select.addEventListener('change', () => render());

  function series(chart, rows, pick) {
    const keys = [...new Set(rows.flatMap((r) => Object.keys(pick(r))))];
    chart.data.labels = rows.map((r) => r.epoch);
    chart.data.datasets = keys.map((k, i) => ({
      label: k, data: rows.map((r) => pick(r)[k] ?? null), borderColor: PALETTE[i % PALETTE.length],
      borderDash: k.startsWith('val') ? [6, 4] : [],
      backgroundColor: PALETTE[i % PALETTE.length], tension: 0.25, pointRadius: 2,
    }));
    chart.update();
  }

  function render() {
    const job = jobs.get(select.value);
    if (!job) return;
    explain.textContent = t(`train.explain.${job.task}`);
    stopBtn.hidden = job.status !== 'running';
    stopBtn.disabled = false;
    const last = job.epochs.at(-1);
    progress.hidden = false;
    progress.value = last ? last.epoch / last.epochs : 0;
    // 損失圖：所有含 loss 的欄位；指標圖：準確度與 mAP（0–1）
    series(lossChart, job.epochs, (r) => Object.fromEntries(
      Object.entries({ ...r.train, ...r.metrics }).filter(([k]) => k.includes('loss'))));
    series(metricChart, job.epochs, (r) => Object.fromEntries(
      Object.entries(r.metrics).filter(([k]) => /accuracy(_top1)?$|mAP50(-95)?\(B\)$/.test(k))));
    logEl.textContent = job.logs.join('\n');
    logEl.scrollTop = logEl.scrollHeight;
  }

  function refreshOptions() {
    select.hidden = false;
    root.querySelector('.train-empty').hidden = true;
    const current = select.value;
    select.replaceChildren(...[...jobs.entries()].reverse().map(([id, j]) => {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = t('train.job', { dataset: j.dataset, status: t(`train.status.${j.status}`) });
      return o;
    }));
    if (current && jobs.has(current)) select.value = current;
  }

  return {
    addJob(jobId, { dataset, task }) {
      jobs.set(jobId, { dataset, task, epochs: [], logs: [], status: 'running' });
      refreshOptions();
      select.value = jobId;
      render();
    },
    onEvent(jobId, ev) {
      const job = jobs.get(jobId);
      if (!job) return;
      if (ev.type === 'epoch') job.epochs.push(ev);
      else if (ev.type === 'log') job.logs.push(ev.msg);
      else if (ev.type === 'error') { job.status = 'error'; job.logs.push(`✖ ${ev.msg}`); }
      else if (ev.type === 'done' || ev.type === 'cancelled') job.status = ev.type === 'done' ? 'done' : 'cancelled';
      if (ev.type !== 'batch') {
        if (['done', 'error', 'cancelled'].includes(ev.type)) refreshOptions();
        if (select.value === jobId) render();
      }
    },
  };
}
