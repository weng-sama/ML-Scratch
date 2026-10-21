// 此檔由 scripts/build-tokens.mjs 自動產生，請修改 design/tokens.json 後執行 npm run tokens
export const tokens = {
  "color": {
    "bg": "#f4f5f9",
    "surface": "#ffffff",
    "surfaceMuted": "#eef0f5",
    "surfaceSunken": "#e3e6ee",
    "border": "#d5dae4",
    "text": "#1f2430",
    "textMuted": "#5b6475",
    "textInverse": "#ffffff",
    "brand": "#6d28d9",
    "primary": "#2563eb",
    "primaryHover": "#1d4ed8",
    "onPrimary": "#ffffff",
    "success": "#15803d",
    "successHover": "#166534",
    "warning": "#b45309",
    "danger": "#dc2626",
    "dangerHover": "#b91c1c",
    "ring": "#2563eb",
    "stage": "#1f2430",
    "stageText": "#c7cbe0",
    "canvas": "#fbfbfd",
    "canvasDot": "#d5dae4",
    "wire": "#7a8296",
    "running": "#4ade80",
    "detection": "#be123c",
    "imageOutline": "oklch(0 0 0 / 0.1)",
    "onBrandSubtle": "rgb(255 255 255 / 0.14)",
    "onBrandHover": "rgb(255 255 255 / 0.26)",
    "onBrandDivider": "rgb(255 255 255 / 0.35)",
    "portLabelBg": "rgb(251 251 253 / 0.92)",
    "bubble": {
      "say": "#fef3c7",
      "user": "#dbeafe",
      "assistant": "#d1fae5",
      "error": "#fee2e2",
      "errorText": "#991b1b"
    },
    "node": {
      "dataset": "#2563eb",
      "pretrained": "#7c3aed",
      "train": "#c2410c",
      "camera": "#15803d",
      "textin": "#0e7490",
      "predict": "#be123c",
      "llm": "#0f766e"
    },
    "block": {
      "events": "#b45309",
      "ai": "#be123c",
      "actions": "#7c3aed",
      "logic": "#4338ca",
      "loop": "#15803d",
      "math": "#1d4ed8",
      "text": "#0f766e",
      "variable": "#a21caf"
    },
    "category": {
      "1": "#2563eb",
      "2": "#c2410c",
      "3": "#7c3aed",
      "4": "#15803d",
      "5": "#be123c",
      "6": "#0f766e",
      "7": "#b45309",
      "8": "#0369a1",
      "9": "#a21caf"
    }
  },
  "motion": {
    "fast": "150ms ease-out",
    "normal": "200ms ease-out"
  },
  "font": {
    "family": "\"Noto Sans TC\", \"Microsoft JhengHei\", \"PingFang TC\", system-ui, sans-serif"
  },
  "control": {
    "height": "32px",
    "radius": "6px",
    "fontSize": "13px",
    "paddingX": "12px",
    "gap": "6px"
  },
  "button": {
    "bg": "#ffffff",
    "fg": "#1f2430",
    "shadow": "0 0 0 1px oklch(0 0 0 / 0.08), 0 1px 2px -1px oklch(0 0 0 / 0.08), 0 2px 4px 0 oklch(0 0 0 / 0.04)",
    "shadowHover": "0 0 0 1px oklch(0 0 0 / 0.12), 0 1px 2px -1px oklch(0 0 0 / 0.1), 0 2px 4px 0 oklch(0 0 0 / 0.06)",
    "pressScale": "0.96",
    "disabledOpacity": "0.55",
    "iconPaddingLeft": "10px"
  },
  "icon": {
    "stroke": "1.5",
    "strokeStrong": "2"
  },
  "topbar": {
    "height": "52px",
    "bg": "#6d28d9",
    "fg": "#ffffff"
  },
  "layout": {
    "paletteWidth": "156px",
    "sideWidth": "440px"
  },
  "palette": {
    "itemHeight": "36px"
  },
  "node": {
    "width": "224px",
    "borderWidth": "2px",
    "radius": "8px",
    "titleRadius": "calc(8px - 2px)",
    "labelWidth": "64px",
    "shadow": "0 1px 3px oklch(0 0 0 / 0.1)",
    "selectedRing": "3px"
  },
  "port": {
    "size": "18px",
    "hitSize": "34px",
    "gap": "18px",
    "halo": "4px",
    "labelOffset": "22px"
  },
  "wire": {
    "width": "4px"
  },
  "tab": {
    "height": "44px",
    "indicator": "3px"
  },
  "thumb": {
    "width": "56px",
    "height": "42px",
    "radius": "4px",
    "deleteSize": "22px",
    "deleteHitInset": "-7px"
  },
  "card": {
    "radius": "12px",
    "padding": "8px"
  },
  "strip": {
    "radius": "calc(4px + 2px)"
  },
  "toast": {
    "bg": "#1f2430",
    "fg": "#ffffff",
    "shadow": "0 4px 12px oklch(0 0 0 / 0.2)"
  },
  "chart": {
    "height": "200px"
  },
  "log": {
    "maxHeight": "180px",
    "minHeight": "120px"
  },
  "focus": {
    "width": "2px",
    "offset": "2px"
  }
};

// 類別色序列（訓練曲線、標註框）
export const categoryColors = Object.values(tokens.color.category);
