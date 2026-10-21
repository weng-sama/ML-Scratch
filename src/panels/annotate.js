// 標註面板：收集與標註資料（圖片分類拍照、物件偵測畫框、文字貼標籤）
import { api } from '../api.js';
import { attach, ensureCamera, grabFrame } from '../camera.js';
import { t } from '../i18n/index.js';
import { iconButton } from '../icons.js';
import { categoryColors as BOX_COLORS, tokens } from '../tokens/tokens.js';

const h = (tag, props = {}, ...children) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children.filter((c) => c != null));
  return el;
};


// 刪除需要確認，避免誤觸
const confirmDelete = () => confirm(t('annotate.confirmDelete'));

export function createAnnotator(root, { notify }) {
  let ds = null; // { name, task, classes, items }
  let detect = null; // 物件偵測編輯狀態
  root.innerHTML = `<div class="annotate-empty">${t('annotate.empty')}</div>`;

  async function reload() {
    const data = await api.dataset(ds.name);
    ds.classes = data.meta.classes;
    ds.items = data.items;
  }

  async function open(name, task) {
    await api.createDataset(name, task);
    ds = { name, task, classes: [], items: [] };
    detect = null;
    await reload();
    render();
  }

  async function addClass() {
    const name = prompt(t('annotate.classPrompt'))?.trim();
    if (!name) return;
    try {
      await api.setClasses(ds.name, [...ds.classes, name]);
      await reload();
      render();
    } catch (err) { notify(err.message); }
  }

  async function importFolder(label) {
    const path = await window.mlscratch?.openFolder();
    if (!path) return;
    try {
      const r = await api.importFolder(ds.name, path, label);
      notify(t('annotate.imported', { n: r.imported }));
      await reload();
      render();
    } catch (err) { notify(err.message); }
  }

  async function cameraBox() {
    const video = h('video', { className: 'annotate-video' });
    try {
      await ensureCamera();
      attach(video);
    } catch (err) {
      notify(t('graphErr.noCamera', { msg: err.message }));
    }
    return video;
  }

  // 按住按鈕連拍，放開停止
  function burstButton(label, onShot) {
    const btn = iconButton('camera', label, { label: t('annotate.burst'), className: 'primary' });
    const text = btn.querySelector('span');
    let timer = null;
    let n = 0;
    const stop = async () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      btn.classList.remove('capturing');
      text.textContent = label;
      await reload();
      render();
    };
    btn.addEventListener('pointerdown', () => {
      n = 0;
      btn.classList.add('capturing');
      const shot = () => {
        const f = grabFrame();
        if (!f) return;
        text.textContent = t('annotate.capturing', { n: ++n });
        onShot(f).catch((err) => notify(err.message));
      };
      shot();
      timer = setInterval(shot, 250);
    });
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointerleave', stop);
    return btn;
  }

  function header() {
    return h('div', { className: 'annotate-head' },
      h('b', { textContent: ds.name }), h('span', { className: 'tag', textContent: t(`task.${ds.task}`) }));
  }

  // ---------- 圖片分類 ----------
  async function renderImageCls() {
    const rows = ds.classes.map((cls) => {
      const items = ds.items.filter((i) => i.label === cls);
      const thumbs = h('div', { className: 'thumbs' }, ...items.slice(-12).reverse().map((it) => {
        const del = iconButton('x', '', { label: t('annotate.deleteItem'), className: 'thumb-del' });
        del.onclick = async () => {
          if (!confirmDelete()) return;
          await api.deleteItem(ds.name, it.id);
          await reload();
          render();
        };
        return h('div', { className: 'thumb' }, h('img', { src: api.imageUrl(ds.name, it.id), alt: cls, loading: 'lazy' }), del);
      }));
      return h('div', { className: 'class-row' },
        h('div', { className: 'class-row-head' },
          h('b', { textContent: cls }), h('span', { textContent: t('annotate.count', { n: items.length }) }),
          burstButton(t('annotate.capture'), (f) => api.addImage(ds.name, f, cls)),
          window.mlscratch ? Object.assign(iconButton('folderOpen', '', { label: t('annotate.importFolder') }), { onclick: () => importFolder(cls) }) : null),
        thumbs);
    });
    root.replaceChildren(header(), await cameraBox(),
      h('div', { className: 'toolbar' },
        Object.assign(iconButton('plus', t('annotate.addClass')), { onclick: addClass }),
        window.mlscratch ? Object.assign(iconButton('folderOpen', t('annotate.importFolder')), { onclick: () => importFolder() }) : null),
      ...rows);
  }

  // ---------- 文字分類 ----------
  function renderTextCls() {
    const input = h('textarea', { rows: 2, placeholder: t('annotate.textPlaceholder'), ariaLabel: t('annotate.textPlaceholder') });
    const select = h('select', { ariaLabel: t('annotate.classes') }, ...ds.classes.map((c) => h('option', { value: c, textContent: c })));
    const add = async () => {
      if (!ds.classes.length) return notify(t('annotate.needClass'));
      if (!input.value.trim()) return;
      try {
        await api.addText(ds.name, input.value, select.value);
        input.value = '';
        await reload();
        renderList();
        input.focus();
      } catch (err) { notify(err.message); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add(); } });
    const list = h('div', { className: 'samples' });
    const renderList = () => {
      const counts = ds.classes.map((c) => `${c}：${ds.items.filter((i) => i.label === c).length}`).join('　');
      list.replaceChildren(h('div', { className: 'muted', textContent: counts }),
        ...ds.items.slice(-100).reverse().map((s) => h('div', { className: 'sample' },
          h('span', { className: 'tag', textContent: s.label }), h('span', { textContent: s.text }),
          Object.assign(iconButton('x', '', { label: t('annotate.deleteItem'), className: 'link' }), { onclick: async () => {
            if (!confirmDelete()) return;
            await api.deleteItem(ds.name, s.id);
            await reload();
            renderList();
          } }))));
    };
    const importCsv = async () => {
      const path = await window.mlscratch?.openFile([{ name: 'CSV', extensions: ['csv'] }]);
      if (!path) return;
      try {
        const r = await api.importCsv(ds.name, path);
        notify(t('annotate.imported', { n: r.imported }));
        await reload();
        render();
      } catch (err) { notify(err.message); }
    };
    root.replaceChildren(header(),
      h('div', { className: 'toolbar' },
        Object.assign(iconButton('plus', t('annotate.addClass')), { onclick: addClass }),
        window.mlscratch ? Object.assign(iconButton('fileText', t('annotate.importCsv')), { onclick: importCsv }) : null),
      input, h('div', { className: 'toolbar' }, select,
        Object.assign(iconButton('plus', t('annotate.addText'), { className: 'primary' }), { onclick: add })),
      list);
    renderList();
  }

  // ---------- 物件偵測 ----------
  async function renderDetect() {
    detect ??= { index: Infinity, cls: 0, boxes: [], selected: -1 };
    detect.index = Math.max(0, Math.min(detect.index, ds.items.length - 1));
    const canvas = h('canvas', { className: 'bbox-canvas' });
    const img = new Image();
    const chips = h('div', { className: 'chips' }, ...ds.classes.map((c, i) => h('button', {
      className: `chip${i === detect.cls ? ' active' : ''}`, textContent: `${i + 1} ${c}`, ariaPressed: String(i === detect.cls),
      style: `--chip:${BOX_COLORS[i % BOX_COLORS.length]}`,
      onclick: () => { detect.cls = i; render(); },
    })));
    const strip = h('div', { className: 'thumbs strip' }, ...ds.items.map((it, i) => h('button', {
      type: 'button', className: `strip-item${it.labeled ? ' labeled' : ''}${i === detect.index ? ' current' : ''}`,
      title: t(it.labeled ? 'annotate.labeled' : 'annotate.unlabeled'), ariaLabel: `${i + 1}／${ds.items.length}（${t(it.labeled ? 'annotate.labeled' : 'annotate.unlabeled')}）`,
      onclick: () => goto(i),
    }, h('img', { src: api.imageUrl(ds.name, it.id), alt: '', loading: 'lazy' }))));
    const item = ds.items[detect.index];

    const draw = () => {
      if (!img.complete || !img.naturalWidth) return;
      const w = canvas.clientWidth;
      const hh = Math.round(w * img.naturalHeight / img.naturalWidth);
      canvas.width = w;
      canvas.height = hh;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, hh);
      ctx.lineWidth = 2;
      ctx.font = `bold 13px ${tokens.font.family}`;
      detect.boxes.forEach((b, i) => {
        const color = BOX_COLORS[b.cls % BOX_COLORS.length];
        ctx.strokeStyle = color;
        ctx.setLineDash(i === detect.selected ? [6, 4] : []);
        ctx.strokeRect((b.x - b.w / 2) * w, (b.y - b.h / 2) * hh, b.w * w, b.h * hh);
        ctx.fillStyle = color;
        ctx.fillText(ds.classes[b.cls] ?? '?', (b.x - b.w / 2) * w + 3, (b.y - b.h / 2) * hh + 14);
      });
      ctx.setLineDash([]);
    };

    const save = async () => {
      if (!item) return;
      await api.setBoxes(ds.name, item.id, detect.boxes);
      item.labeled = true;
    };

    const goto = async (i) => {
      if (i < 0 || i >= ds.items.length) return;
      detect.index = i;
      detect.selected = -1;
      render();
    };

    // 拖曳畫框；點一下已存在的框則選取
    let start = null;
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    };
    canvas.addEventListener('pointerdown', (e) => {
      start = pos(e);
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!start) return;
      const p = pos(e);
      draw();
      const ctx = canvas.getContext('2d');
      ctx.strokeStyle = BOX_COLORS[detect.cls % BOX_COLORS.length];
      ctx.strokeRect(start.x * canvas.width, start.y * canvas.height,
        (p.x - start.x) * canvas.width, (p.y - start.y) * canvas.height);
    });
    canvas.addEventListener('pointerup', async (e) => {
      if (!start) return;
      const p = pos(e);
      const [x1, x2] = [Math.max(0, Math.min(start.x, p.x)), Math.min(1, Math.max(start.x, p.x))];
      const [y1, y2] = [Math.max(0, Math.min(start.y, p.y)), Math.min(1, Math.max(start.y, p.y))];
      start = null;
      if (x2 - x1 < 0.01 || y2 - y1 < 0.01) {
        detect.selected = detect.boxes.findIndex((b) => Math.abs(p.x - b.x) <= b.w / 2 && Math.abs(p.y - b.y) <= b.h / 2);
        draw();
        return;
      }
      if (!ds.classes.length) { notify(t('annotate.needClass')); draw(); return; }
      detect.boxes.push({ cls: detect.cls, x: (x1 + x2) / 2, y: (y1 + y2) / 2, w: x2 - x1, h: y2 - y1 });
      draw();
      await save().catch((err) => notify(err.message));
    });

    detect.keyHandler = async (e) => {
      if (e.target.closest('input, textarea, select')) return;
      if (/^[1-9]$/.test(e.key) && Number(e.key) <= ds.classes.length) { detect.cls = Number(e.key) - 1; render(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && detect.selected >= 0) {
        detect.boxes.splice(detect.selected, 1);
        detect.selected = -1;
        draw();
        await save().catch((err) => notify(err.message));
      } else if (e.key === 'a' || e.key === 'A') goto(detect.index - 1);
      else if (e.key === 'd' || e.key === 'D') goto(detect.index + 1);
    };

    root.replaceChildren(header(), await cameraBox(),
      h('div', { className: 'toolbar' },
        burstButton(t('annotate.capture'), (f) => api.addImage(ds.name, f).then(() => { detect.index = Infinity; })),
        window.mlscratch ? Object.assign(iconButton('folderOpen', t('annotate.importFolder')), { onclick: () => importFolder() }) : null,
        Object.assign(iconButton('plus', t('annotate.addClass')), { onclick: addClass })),
      chips,
      h('div', { className: 'muted', textContent: t('annotate.detectHelp') }),
      item ? canvas : h('div', { className: 'muted', textContent: t('annotate.noImages') }),
      strip);

    if (item) {
      detect.boxes = await api.boxes(ds.name, item.id);
      img.onload = draw;
      img.src = api.imageUrl(ds.name, item.id);
      new ResizeObserver(draw).observe(canvas);
    }
  }

  function render() {
    if (!ds) return;
    if (ds.task === 'image_cls') renderImageCls();
    else if (ds.task === 'detect') renderDetect();
    else renderTextCls();
  }

  document.addEventListener('keydown', (e) => {
    if (ds?.task === 'detect' && root.offsetParent && detect?.keyHandler) detect.keyHandler(e);
  });

  return { open };
}
