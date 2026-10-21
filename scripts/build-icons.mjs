// 從 @iconify-json/lucide（Iconify 的 Lucide 圖示資料）產生 src/icon-paths.js
// 新增圖示：在 ICONS 加一行「介面名稱: 'lucide 名稱'」後執行 npm run icons
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ICONS = {
  // 工具列與一般動作
  play: 'play',
  stop: 'square',
  filePlus: 'file-plus',
  folderOpen: 'folder-open',
  save: 'save',
  camera: 'camera',
  plus: 'plus',
  x: 'x',
  fileText: 'file-text',
  send: 'send',
  download: 'download',
  tag: 'tag',
  // 分頁
  tabPreview: 'monitor-play',
  tabTrain: 'chart-line',
  tabAnnotate: 'tag',
  // 節點種類
  nodeDataset: 'database',
  nodePretrained: 'brain',
  nodeTrain: 'dumbbell',
  nodeCamera: 'camera',
  nodeTextin: 'text-cursor-input',
  nodePredict: 'scan-eye',
  nodeLlm: 'message-square',
};

const require = createRequire(import.meta.url);
const set = JSON.parse(readFileSync(require.resolve('@iconify-json/lucide/icons.json'), 'utf-8'));
const pkg = JSON.parse(readFileSync(require.resolve('@iconify-json/lucide/package.json'), 'utf-8'));

// 筆畫屬性統一放在外層 <svg>，讓 CSS 的 stroke-width 能依文字粗細調整；保留 fill="currentColor" 等實心部分
const STRIP = / (fill="none"|stroke="currentColor"|stroke-linecap="round"|stroke-linejoin="round"|stroke-width="2")/g;

function body(name) {
  const icon = set.icons[name] ?? set.icons[set.aliases?.[name]?.parent];
  if (!icon) throw new Error(`Lucide 沒有圖示：${name}`);
  if ((icon.width ?? set.width ?? 24) !== 24) throw new Error(`${name} 不是 24×24 格線`);
  return icon.body.replace(STRIP, '').replace(/<g>(.*)<\/g>/s, '$1');
}

const lines = Object.entries(ICONS).map(([key, name]) => `  ${key}: ${JSON.stringify(body(name))}, // lucide:${name}`);
writeFileSync('src/icon-paths.js', `// 此檔由 scripts/build-icons.mjs 自動產生（Lucide ${pkg.version}，ISC 授權），請勿手改
export const PATHS = {
${lines.join('\n')}
};
`);
console.log(`icons: ${lines.length} 個 → src/icon-paths.js`);
