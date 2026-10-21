// Scratch 風格的邏輯積木（Blockly）：自訂 AI 積木、工具箱與程式碼產生
import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import { javascriptGenerator, Order } from 'blockly/javascript';
import * as ZhHant from 'blockly/msg/zh-hant';
import { t } from './i18n/index.js';
import { nodesOfType } from './graph.js';

// 積木白字對比皆 ≥ 4.5:1；內建分類也改用較深的顏色
const COLORS = { events: '#b45309', ai: '#be123c', actions: '#7c3aed' };
const BUILTIN = { logic: '#4338ca', loop: '#15803d', math: '#1d4ed8', text: '#0f766e', variable: '#a21caf' };
const HATS = new Set(['ml_when_start', 'ml_when_result', 'ml_when_text', 'ml_when_llm']);
let workspace;

// 下拉選單：列出畫布上的推論／LLM 節點
const nodeOptions = (type) => () => {
  const opts = nodesOfType(type).map((n) => [n.data.title, String(n.id)]);
  return opts.length ? opts : [[t('blocks.none'), '']];
};

function defineBlocks() {
  const nodeField = (type) => ({ type: 'field_dropdown', name: 'NODE', options: nodeOptions(type) });
  const hat = (type, message, args = []) => ({
    type, message0: message, args0: args, colour: COLORS.events,
    nextStatement: null, style: { hat: 'cap' }, // 帽子積木：頂端圓弧，和 Scratch 的事件積木一樣
  });
  const defs = [
    hat('ml_when_start', t('blocks.whenStart')),
    hat('ml_when_result', t('blocks.whenResult'), [nodeField('predict')]),
    hat('ml_when_text', t('blocks.whenText')),
    hat('ml_when_llm', t('blocks.whenLlm'), [nodeField('llm')]),
    { type: 'ml_result_label', message0: t('blocks.resultLabel'), output: 'String', colour: COLORS.ai, tooltip: t('blocks.resultTooltip') },
    { type: 'ml_result_conf', message0: t('blocks.resultConf'), output: 'Number', colour: COLORS.ai, tooltip: t('blocks.resultTooltip') },
    {
      type: 'ml_count_of', message0: t('blocks.countOf'), output: 'Number', colour: COLORS.ai,
      args0: [{ type: 'input_value', name: 'LABEL', check: 'String' }], inputsInline: true, tooltip: t('blocks.resultTooltip'),
    },
    { type: 'ml_result_text', message0: t('blocks.resultText'), output: 'String', colour: COLORS.ai, tooltip: t('blocks.resultTooltip') },
    {
      type: 'ml_classify_text', message0: t('blocks.classifyText'), output: 'String', colour: COLORS.ai, inputsInline: true,
      args0: [nodeField('predict'), { type: 'input_value', name: 'TEXT' }],
    },
    {
      type: 'ml_ask_llm', message0: t('blocks.askLlm'), output: 'String', colour: COLORS.ai, inputsInline: true,
      args0: [nodeField('llm'), { type: 'input_value', name: 'TEXT' }],
    },
    {
      type: 'ml_say', message0: t('blocks.say'), colour: COLORS.actions, previousStatement: null, nextStatement: null,
      args0: [{ type: 'input_value', name: 'TEXT' }],
    },
    {
      type: 'ml_speak', message0: t('blocks.speak'), colour: COLORS.actions, previousStatement: null, nextStatement: null,
      args0: [{ type: 'input_value', name: 'TEXT' }],
    },
    {
      type: 'ml_wait', message0: t('blocks.wait'), colour: COLORS.actions, previousStatement: null, nextStatement: null,
      args0: [{ type: 'input_value', name: 'SEC', check: 'Number' }], inputsInline: true,
    },
    { type: 'ml_clear_log', message0: t('blocks.clearLog'), colour: COLORS.actions, previousStatement: null, nextStatement: null },
  ];
  Blockly.common.defineBlocksWithJsonArray(defs);

  const g = javascriptGenerator;
  const val = (block, name, fallback = "''") => g.valueToCode(block, name, Order.NONE) || fallback;
  // 帽子積木的下一個積木就是事件內容：把後續積木當成函式本體產生
  for (const [type, event, keyFn] of [
    ['ml_when_start', 'start', () => ''],
    ['ml_when_result', 'result', (b) => b.getFieldValue('NODE')],
    ['ml_when_text', 'text', () => ''],
    ['ml_when_llm', 'llm', (b) => b.getFieldValue('NODE')],
  ]) {
    g.forBlock[type] = (block) => {
      const next = block.getNextBlock();
      const body = next ? g.prefixLines(g.blockToCode(next, false), g.INDENT) : '';
      return `__rt.on(${JSON.stringify(event)}, ${JSON.stringify(keyFn(block))}, async (__r) => {\n${body}});\n`;
    };
  }
  g.forBlock.ml_result_label = () => ['__rt.label(__r)', Order.FUNCTION_CALL];
  g.forBlock.ml_result_conf = () => ['__rt.conf(__r)', Order.FUNCTION_CALL];
  g.forBlock.ml_count_of = (b) => [`__rt.count(__r, ${val(b, 'LABEL')})`, Order.FUNCTION_CALL];
  g.forBlock.ml_result_text = () => ['__rt.text(__r)', Order.FUNCTION_CALL];
  g.forBlock.ml_classify_text = (b) => [
    `(await __rt.classifyText(${JSON.stringify(b.getFieldValue('NODE'))}, ${val(b, 'TEXT')}))`, Order.ATOMIC];
  g.forBlock.ml_ask_llm = (b) => [
    `(await __rt.askLLM(${JSON.stringify(b.getFieldValue('NODE'))}, ${val(b, 'TEXT')}))`, Order.ATOMIC];
  g.forBlock.ml_say = (b) => `__rt.say(${val(b, 'TEXT')});\n`;
  g.forBlock.ml_speak = (b) => `await __rt.speak(${val(b, 'TEXT')});\n`;
  g.forBlock.ml_wait = (b) => `await __rt.wait(${val(b, 'SEC', '1')});\n`;
  g.forBlock.ml_clear_log = () => '__rt.clearLog();\n';
  // 迴圈每圈讓出執行權並檢查是否已按停止，避免無窮迴圈卡死畫面
  g.INFINITE_LOOP_TRAP = 'await __rt.tick();\n';
}

function toolbox() {
  const c = (key) => t(`blocks.cat.${key}`);
  const b = (type, extra = {}) => ({ kind: 'block', type, ...extra });
  const shadowNum = (n) => ({ shadow: { type: 'math_number', fields: { NUM: n } } });
  const shadowText = (s) => ({ shadow: { type: 'text', fields: { TEXT: s } } });
  return {
    kind: 'categoryToolbox',
    contents: [
      { kind: 'category', name: c('events'), colour: COLORS.events, contents: [
        b('ml_when_start'), b('ml_when_result'), b('ml_when_text'), b('ml_when_llm')] },
      { kind: 'category', name: c('ai'), colour: COLORS.ai, contents: [
        b('ml_result_label'), b('ml_result_conf'), b('ml_count_of', { inputs: { LABEL: shadowText('person') } }),
        b('ml_result_text'), b('ml_classify_text', { inputs: { TEXT: shadowText('') } }),
        b('ml_ask_llm', { inputs: { TEXT: shadowText('') } })] },
      { kind: 'category', name: c('actions'), colour: COLORS.actions, contents: [
        b('ml_say', { inputs: { TEXT: shadowText('') } }), b('ml_speak', { inputs: { TEXT: shadowText('') } }),
        b('ml_wait', { inputs: { SEC: shadowNum(1) } }), b('ml_clear_log')] },
      { kind: 'category', name: c('control'), categorystyle: 'loop_category', contents: [
        b('controls_if'), b('controls_if', { extraState: { hasElse: true } }),
        b('controls_repeat_ext', { inputs: { TIMES: shadowNum(10) } }), b('controls_whileUntil')] },
      { kind: 'category', name: c('logic'), categorystyle: 'logic_category', contents: [
        b('logic_compare'), b('logic_operation'), b('logic_negate'), b('logic_boolean'),
        b('math_number'), b('math_arithmetic'), b('math_random_int', { inputs: { FROM: shadowNum(1), TO: shadowNum(10) } }),
        b('math_round')] },
      { kind: 'category', name: c('text'), categorystyle: 'text_category', contents: [
        b('text'), b('text_join'), b('text_length'), b('text_indexOf'), b('text_isEmpty')] },
      { kind: 'category', name: c('vars'), categorystyle: 'variable_category', custom: 'VARIABLE' },
    ],
  };
}

export function initBlocks(container) {
  Blockly.setLocale(ZhHant);
  defineBlocks();
  workspace = Blockly.inject(container, {
    toolbox: toolbox(),
    media: './media/',
    sounds: false,
    trashcan: true,
    zoom: { controls: true, wheel: false, startScale: 0.85 },
    move: { scrollbars: true, drag: true, wheel: true },
    grid: { spacing: 24, length: 2, colour: '#e3e6ee', snap: true },
    renderer: 'zelos', // 最接近 Scratch 的外觀
    theme: Blockly.Theme.defineTheme('ml-scratch', {
      base: Blockly.Themes.Classic,
      blockStyles: Object.fromEntries(Object.entries(BUILTIN).map(([k, c]) => [`${k}_blocks`, { colourPrimary: c }])),
      categoryStyles: Object.fromEntries(Object.entries(BUILTIN).map(([k, c]) => [`${k}_category`, { colour: c }])),
      componentStyles: { toolboxBackgroundColour: '#eef0f5', flyoutBackgroundColour: '#e3e6ee' },
    }),
  });
  new ResizeObserver(() => Blockly.svgResize(workspace)).observe(container);
  return workspace;
}

// 只產生帽子積木底下的程式；散落的積木（像 Scratch 一樣）不執行
export function generateCode() {
  const g = javascriptGenerator;
  g.init(workspace);
  let code = '';
  for (const block of workspace.getTopBlocks(true)) {
    if (HATS.has(block.type) && block.isEnabled()) code += g.blockToCode(block, true);
  }
  return g.finish(code);
}

export const saveBlocks = () => Blockly.serialization.workspaces.save(workspace);
export const loadBlocks = (state) => Blockly.serialization.workspaces.load(state, workspace);
export const clearBlocks = () => workspace.clear();
