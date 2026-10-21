// 由 design/tokens.json 產生 src/tokens/tokens.css（CSS 變數）與 src/tokens/tokens.js（解析後的實際值）
// CSS 保留層級引用（var(--…)），JS 給 Blockly、Chart.js、Canvas 等無法讀取 CSS 變數的程式庫使用
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SRC = 'design/tokens.json';
const OUT = 'src/tokens';
const tokens = JSON.parse(readFileSync(SRC, 'utf-8'));
const LAYERS = ['primitive', 'semantic', 'component'];

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
// 不含層級名稱：primitive.color.blue.600 → --color-blue-600
const varName = (path) => `--${path.slice(1).map(kebab).join('-')}`;
const REF = /\{([^}]+)\}/g;

function lookup(ref) {
  const node = ref.split('.').reduce((o, k) => o?.[k], tokens);
  if (!node || !('$value' in node)) throw new Error(`找不到權杖引用：{${ref}}`);
  return node;
}

const toCss = (value) => value.replace(REF, (_, ref) => `var(${varName(ref.split('.'))})`);
const resolve = (value, seen = []) => value.replace(REF, (_, ref) => {
  if (seen.includes(ref)) throw new Error(`循環引用：${[...seen, ref].join(' → ')}`);
  return resolve(lookup(ref).$value, [...seen, ref]);
});

function walk(node, path, visit) {
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    if (child && typeof child === 'object' && '$value' in child) visit([...path, key], child);
    else if (child && typeof child === 'object') walk(child, [...path, key], visit);
  }
}

// ---------- CSS ----------
let css = '/* 此檔由 scripts/build-tokens.mjs 自動產生，請修改 design/tokens.json 後執行 npm run tokens */\n:root {\n';
for (const layer of LAYERS) {
  css += `  /* ===== ${layer} ===== */\n`;
  walk(tokens[layer], [layer], (path, tok) => {
    const note = tok.$description ? ` /* ${tok.$description} */` : '';
    css += `  ${varName(path)}: ${toCss(String(tok.$value))};${note}\n`;
  });
}
css += '}\n';

// ---------- JS（semantic 與 component，數值已解析） ----------
const js = {};
for (const layer of ['semantic', 'component']) {
  walk(tokens[layer], [layer], (path, tok) => {
    const keys = path.slice(1);
    const parent = keys.slice(0, -1).reduce((o, k) => (o[k] ??= {}), js);
    parent[keys.at(-1)] = resolve(String(tok.$value));
  });
}
const jsOut = '// 此檔由 scripts/build-tokens.mjs 自動產生，請修改 design/tokens.json 後執行 npm run tokens\n'
  + `export const tokens = ${JSON.stringify(js, null, 2)};\n\n`
  + '// 類別色序列（訓練曲線、標註框）\n'
  + 'export const categoryColors = Object.values(tokens.color.category);\n';

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/tokens.css`, css);
writeFileSync(`${OUT}/tokens.js`, jsOut);
console.log(`tokens: ${OUT}/tokens.css, ${OUT}/tokens.js`);
