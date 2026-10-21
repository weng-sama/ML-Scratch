// 執行期：按下 ▶ 後依節點連線啟動攝影機推論迴圈，並執行積木產生的程式
import { api } from './api.js';
import { ensureCamera, grabFrame } from './camera.js';
import { t } from './i18n/index.js';
import { getNode, inputNode, nodesOfType, outputNodes } from './graph.js';
import { generateCode } from './blocks.js';

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

class Stopped extends Error {}

// 解析推論節點的模型：接預訓練模型 → "pretrained:<key>"；接訓練節點 → 訓練出的模型編號
export function resolveModel(node) {
  const src = inputNode(node, 1);
  if (!src) throw new Error(t('graphErr.needModel', { node: node.data.title }));
  if (src.name === 'pretrained') return `pretrained:${src.data.key}`;
  if (!src.data.modelId) throw new Error(t('graphErr.notTrained', { node: node.data.title }));
  return src.data.modelId;
}

export class Runtime {
  constructor(ui) {
    this.ui = ui; // { say, clearLog, showResult, chat, error, setRunning }
    this.running = false;
    this.handlers = [];
    this.timers = [];
    this.ticks = 0;
  }

  async start() {
    this.stop();
    this.running = true;
    this.ui.setRunning(true);
    try {
      const predicts = nodesOfType('predict');
      const sources = predicts.map((n) => [n, inputNode(n, 2)]);
      for (const [n, src] of sources) {
        resolveModel(n);
        if (!src) throw new Error(t('graphErr.needSource', { node: n.data.title }));
      }
      if (sources.some(([, s]) => s.name === 'camera')) {
        try {
          await ensureCamera();
        } catch (err) {
          throw new Error(t('graphErr.noCamera', { msg: err.message }));
        }
        this.ui.showCamera();
      }
      new AsyncFunction('__rt', generateCode())(this.api());
      for (const [n, src] of sources) if (src.name === 'camera') this.loopCamera(n.id);
      this.fire('start', '', {});
    } catch (err) {
      this.ui.error(err.message);
      this.stop();
    }
  }

  stop() {
    this.running = false;
    this.handlers = [];
    this.timers.forEach(clearTimeout);
    this.timers = [];
    speechSynthesis.cancel();
    this.ui.setRunning(false);
  }

  on(event, key, fn) {
    this.handlers.push({ event, key: String(key), fn, busy: false });
  }

  // 同一個事件積木上一輪還沒跑完時略過（和 Scratch 一樣不重複觸發）
  fire(event, key, payload) {
    for (const h of this.handlers) {
      if (h.event !== event || h.key !== String(key) || h.busy) continue;
      h.busy = true;
      h.fn(payload)
        .catch((err) => { if (!(err instanceof Stopped)) this.ui.error(err.message); })
        .finally(() => { h.busy = false; });
    }
  }

  loopCamera(nodeId) {
    const step = async () => {
      if (!this.running) return;
      const node = getNode(nodeId);
      const frame = grabFrame();
      if (frame) {
        try {
          const res = await api.predict({ model: resolveModel(node), image: frame, conf: Number(node.data.conf) || 0.25 });
          if (!this.running) return;
          this.ui.showResult(node, res);
          this.fire('result', nodeId, res);
        } catch (err) {
          this.ui.error(err.message);
          this.stop();
          return;
        }
      }
      this.timers.push(setTimeout(step, Math.max(100, Number(node.data.interval) || 300)));
    };
    step();
  }

  // 使用者在預覽面板輸入文字：觸發積木事件，並送到接了「文字輸入」的推論與 LLM 節點
  async userText(text) {
    if (!this.running) await this.start();
    if (!this.running) return;
    this.fire('text', '', { text });
    for (const src of nodesOfType('textin')) {
      for (const target of outputNodes(src)) {
        try {
          if (target.name === 'predict') {
            const res = await this.classify(target.id, text);
            this.ui.showResult(target, res);
            this.fire('result', target.id, res);
          } else if (target.name === 'llm') {
            await this.askLLM(target.id, text);
          }
        } catch (err) {
          this.ui.error(err.message);
        }
      }
    }
  }

  async classify(nodeId, text) {
    const node = getNode(nodeId);
    return api.predict({ model: resolveModel(node), text: String(text) });
  }

  async askLLM(nodeId, prompt) {
    const node = getNode(nodeId);
    this.ui.chat('user', String(prompt), node.data.title);
    const messages = [{ role: 'system', content: node.data.system }, { role: 'user', content: String(prompt) }];
    const { reply } = await api.llmChat(node.data.model, messages);
    if (!this.running) throw new Stopped();
    this.ui.chat('assistant', reply, node.data.title);
    this.fire('llm', nodeId, { text: reply, label: reply });
    return reply;
  }

  // 提供給積木程式的 __rt 物件
  api() {
    const check = () => { if (!this.running) throw new Stopped(); };
    return {
      on: (event, key, fn) => this.on(event, key, fn),
      label: (r) => r?.label ?? '',
      conf: (r) => Math.round((r?.conf ?? 0) * 100),
      count: (r, label) => (r?.boxes || []).filter((b) => b.label === String(label)).length,
      text: (r) => r?.text ?? '',
      classifyText: async (id, text) => { check(); const r = await this.classify(id, text); check(); return r.label; },
      askLLM: async (id, text) => { check(); return this.askLLM(id, text); },
      say: (text) => { check(); this.ui.say(String(text)); },
      clearLog: () => this.ui.clearLog(),
      speak: (text) => new Promise((resolve) => {
        check();
        const u = new SpeechSynthesisUtterance(String(text));
        u.lang = 'zh-TW';
        u.onend = u.onerror = resolve;
        speechSynthesis.speak(u);
      }),
      wait: (sec) => new Promise((resolve, reject) => {
        check();
        this.timers.push(setTimeout(() => (this.running ? resolve() : reject(new Stopped())), Number(sec) * 1000));
      }),
      tick: async () => {
        check();
        if (++this.ticks % 50 === 0) await new Promise((r) => setTimeout(r, 0));
        check();
      },
    };
  }
}
