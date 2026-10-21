import zhTW from './zh-TW.js';

const LOCALES = { 'zh-TW': zhTW };
let dict = LOCALES['zh-TW'];

export function setLocale(code) {
  dict = LOCALES[code] || LOCALES['zh-TW'];
}

// t('node.train.running', { epoch: 1, epochs: 10 })
export function t(key, vars = {}) {
  const val = key.split('.').reduce((o, k) => (o == null ? o : o[k]), dict);
  if (typeof val !== 'string') return key;
  return val.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}
