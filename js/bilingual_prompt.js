import { app } from "../../scripts/app.js";
import {
  analyzePromptSyntax,
  buildDictionaryIndex,
  detectInputMode,
  normalizeKey,
  parsePrompt,
  removePromptToken,
  replacePromptTokenWeight,
  validateTranslationResult,
} from "./parser.js";
import {
  mergeImportAsAliases,
  normalizePreferences,
  previewImport,
  rankDictionaryTags,
  recordRecent,
  suggestedTags,
  toggleFavorite,
} from "./dictionary_tools.js";
import { sortAnimaPrompt } from "./anima_sorter.js";
import { panelSyncHub } from "./panel_sync.js";
import { installBpiWheelGuard } from "./wheel_guard.js";

const NODE_NAME = "BilingualPromptInspector";
const API_ROOT = "/bpi";
const EXTENSION_VERSION = "v19 Final";
const AUTHOR_URL = "https://space.bilibili.com/697555747";
const PREFERENCES_KEY = "bpi.dictionary.preferences.v1";
const COLLAPSED_WIDGET_FALLBACK_HEIGHT = 390;
const EXPANDED_WIDGET_MIN_HEIGHT = 820;
const EXPANDED_WIDGET_MAX_HEIGHT = 1160;
const COLLAPSED_NODE_MIN_HEIGHT = 520;
const EXPANDED_NODE_DEFAULT_HEIGHT = 1060;

let dictionaryPromise = null;
let sessionTokenPromise = null;

async function getSessionToken(force = false) {
  if (!sessionTokenPromise || force) {
    sessionTokenPromise = fetch(`${API_ROOT}/session`, { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        const token = result?.data?.token;
        if (!response.ok || !result.success || !token) throw new Error(result.error || "本机会话初始化失败");
        return token;
      })
      .catch((error) => {
        sessionTokenPromise = null;
        throw error;
      });
  }
  return sessionTokenPromise;
}

async function bpiFetch(url, options = {}, retry = true) {
  const token = await getSessionToken();
  const headers = new Headers(options.headers ?? {});
  headers.set("X-BPI-Token", token);
  const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
  if (response.status === 403 && retry) {
    await getSessionToken(true);
    return bpiFetch(url, options, false);
  }
  return response;
}

function loadPreferences() {
  try {
    return normalizePreferences(JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "{}"));
  } catch {
    return normalizePreferences({});
  }
}

function savePreferences(preferences) {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(normalizePreferences(preferences)));
  } catch (error) {
    console.warn("[BilingualPromptInspector] 无法保存收藏与最近使用", error);
  }
}

function loadDictionary(force = false) {
  if (!dictionaryPromise || force) {
    dictionaryPromise = bpiFetch(`${API_ROOT}/dictionary`)
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || "词库读取失败");
        return result.data;
      })
      .catch((error) => {
        dictionaryPromise = null;
        throw error;
      });
  }
  return dictionaryPromise;
}

function element(tagName, className, text) {
  const item = document.createElement(tagName);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

function button(label, action, className = "") {
  const item = element("button", `bpi-button ${className}`.trim(), label);
  item.type = "button";
  item.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    action(event);
  });
  return item;
}

function openAuthorAbout() {
  const shade = element("div", "bpi-modal-shade");
  const modal = element("div", "bpi-modal bpi-about-modal");
  modal.append(
    element("h3", "", "关于作者"),
    element("div", "bpi-about-name", `ComfyUI 双语提示词检查器 ${EXTENSION_VERSION}`),
    element("div", "bpi-config-note", "面向 Anima / Danbooru 提示词整理、翻译与检查的 ComfyUI 社区工具。"),
  );
  const actions = element("div", "bpi-modal-actions");
  const authorLink = element("a", "bpi-button bpi-primary", "访问作者社区主页 ↗");
  authorLink.href = AUTHOR_URL;
  authorLink.target = "_blank";
  authorLink.rel = "noopener noreferrer";
  authorLink.referrerPolicy = "no-referrer";
  authorLink.addEventListener("mousedown", (event) => event.stopPropagation());
  authorLink.addEventListener("click", (event) => event.stopPropagation());
  const close = () => shade.remove();
  actions.append(authorLink, button("关闭", close));
  modal.appendChild(actions);
  shade.appendChild(modal);
  document.body.appendChild(shade);
  shade.addEventListener("mousedown", (event) => { if (event.target === shade) close(); });
  modal.addEventListener("mousedown", (event) => event.stopPropagation());
}

function sourceLabel(source, status) {
  if (status === "machine") return "检查器助手";
  const labels = {
    starter: "内置词库",
    builtin: "内置词库",
    user: "个人词库",
    "prompt-assistant": "历史个人词库",
    "bpi-assistant": "检查器助手",
    session: "仅本次修改",
    "danbooru-large": "Danbooru 大型词库",
    syntax: "语法保护",
    unknown: "未知来源",
  };
  return labels[source] ?? source ?? "未知来源";
}

function animaPunctuationError(value) {
  const text = String(value ?? "");
  if (/[\u3400-\u9fff]/.test(text)) return "结果仍包含中文";
  const allowed = new Set(",.():@_-'<>%+/&".split(""));
  const invalid = [...new Set([...text].filter((character) =>
    !/[A-Za-z0-9\s]/.test(character) && !allowed.has(character)
  ))];
  return invalid.length ? `包含不符合 Anima 规则的字符：${invalid.join(" ")}` : "";
}

function injectStyles() {
  if (document.getElementById("bpi-styles")) return;
  const style = document.createElement("style");
  style.id = "bpi-styles";
  style.textContent = `
    .bpi-panel{box-sizing:border-box;width:100%;height:100%;min-height:${EXPANDED_WIDGET_MIN_HEIGHT}px;padding:8px;display:flex;flex-direction:column;gap:7px;color:var(--input-text,#ddd);font:12px/1.4 Arial,sans-serif;background:rgba(10,12,18,.72);border:1px solid #3a4250;border-radius:8px;overflow:hidden}
    .bpi-panel.bpi-details-collapsed{min-height:var(--bpi-collapsed-height,${COLLAPSED_WIDGET_FALLBACK_HEIGHT}px);max-height:var(--bpi-collapsed-height,${COLLAPSED_WIDGET_FALLBACK_HEIGHT}px);overflow-y:auto;scrollbar-gutter:stable}
    .bpi-english-section{flex:none;border:1px solid #3e7197;border-radius:7px;background:rgba(18,29,43,.72);overflow:hidden}.bpi-english-head{display:flex;align-items:center;gap:7px;padding:5px 8px;background:rgba(38,65,88,.66);color:#cbe8ff;font-weight:700;flex-wrap:wrap}.bpi-english-hint{margin-left:auto;color:#91b4cf;font-size:10px;font-weight:400}.bpi-english-token-view{box-sizing:border-box;width:100%;height:auto;min-height:92px;max-height:360px;overflow:auto;scrollbar-gutter:stable;padding:8px 9px;outline:none;color:#d9edff;font:12px/1.85 Consolas,monospace;white-space:normal}.bpi-english-token-view:focus{box-shadow:inset 0 0 0 1px #5aa6d8}.bpi-english-editor{box-sizing:border-box;width:100%;height:120px;min-height:92px;max-height:420px;overflow-y:auto;resize:vertical;border:0;border-top:1px solid #3e7197;background:#111923;color:#edf7ff;padding:9px;outline:none;font:12px/1.55 Consolas,monospace}.bpi-english-editor:focus{box-shadow:inset 0 0 0 1px #5aa6d8}.bpi-english-token{font-family:Consolas,monospace;color:#e8f5ff}.bpi-english-token.bpi-linked{background:#147fc3;border-color:#76c9ff;color:#fff;box-shadow:0 0 0 1px rgba(118,201,255,.32)}
    .bpi-mirror-section{flex:none;border:1px solid #488739;border-radius:7px;background:rgba(20,35,22,.64);overflow:hidden}.bpi-section-head{display:flex;align-items:center;gap:7px;padding:5px 8px;background:rgba(40,68,42,.55);color:#cbe9c8;font-weight:700;flex-wrap:wrap}.bpi-section-hint{margin-left:auto;color:#91ad93;font-size:10px;font-weight:400}.bpi-mirror-actions{display:flex;gap:4px;align-items:center;flex-wrap:wrap}.bpi-chinese-mirror{box-sizing:border-box;width:100%;height:auto;min-height:92px;max-height:360px;overflow:auto;resize:none;scrollbar-gutter:stable;padding:8px 9px;outline:none;color:#d7f3d3;line-height:1.85;cursor:text;white-space:normal}.bpi-chinese-mirror:focus{box-shadow:inset 0 0 0 1px #70b35f}.bpi-chinese-editor{box-sizing:border-box;width:100%;height:auto;min-height:110px;max-height:360px;overflow-y:auto;resize:none;border:0;border-top:1px solid #3b693c;background:#101b13;color:#e0f6dc;padding:9px;outline:none;font:12px/1.65 Arial,sans-serif}.bpi-chinese-editor:focus{box-shadow:inset 0 0 0 1px #70b35f}.bpi-hidden{display:none!important}.bpi-mirror-empty{color:#829486}.bpi-mirror-token{display:inline-flex;align-items:center;border:1px solid transparent;border-radius:5px;padding:0 3px;margin:1px 0;cursor:pointer;transition:background .12s,border-color .12s,color .12s}.bpi-mirror-token:hover{background:#345a3b;border-color:#5c8d63;color:#fff}.bpi-mirror-token.bpi-linked{background:#315f83;border-color:#72b7e8;color:#fff;box-shadow:0 0 0 1px rgba(98,181,239,.2)}.bpi-mirror-token.bpi-unknown{background:rgba(116,70,24,.45);border-color:#9a672e;color:#ffd18a}.bpi-mirror-token.bpi-machine{background:rgba(82,57,125,.55);border-color:#7659a1;color:#d8c5ff}.bpi-mirror-token.bpi-special{color:#aeb8c4}.bpi-mirror-separator{color:#6f8f75;white-space:pre}.bpi-mirror-delete{margin-left:4px;color:#ffb0b5;font-weight:700}.bpi-details-head{display:flex;align-items:center;gap:8px;border:1px solid #66551f;border-radius:6px;background:rgba(66,53,16,.42);padding:5px 7px;color:#ecd77d}.bpi-details-summary{margin-left:auto;color:#c8bc86;font-size:10px}.bpi-details-body{min-height:0;flex:1;display:flex;flex-direction:column;gap:7px;overflow:hidden}.bpi-details-body.bpi-collapsed{display:none}
    .bpi-mirror-token.bpi-linked,.bpi-english-token.bpi-linked{background:#147fc3;border-color:#76c9ff;color:#fff;box-shadow:0 0 0 1px rgba(118,201,255,.32)}.bpi-english-token-view .bpi-mirror-separator{color:#7194ad}
    .bpi-toolbar,.bpi-search-line,.bpi-summary{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
    .bpi-toolbar{justify-content:space-between}.bpi-toolbar-group{display:flex;gap:5px;align-items:center;flex-wrap:wrap}
    .bpi-button{border:1px solid #4c5668;border-radius:5px;padding:4px 8px;background:#2c3340;color:#e8edf5;cursor:pointer;font-size:11px;line-height:1.25}
    .bpi-button:hover{background:#3a4658;border-color:#6c83a8}.bpi-button:disabled{opacity:.45;cursor:default}.bpi-button.bpi-primary{background:#285f8e;border-color:#3f83ba}.bpi-button.bpi-danger{background:#65313b;border-color:#8d4653}
    .bpi-search{flex:1;min-width:140px;border:1px solid #4b5567;border-radius:5px;background:#171b22;color:#eef3fb;padding:5px 7px;outline:none}.bpi-search:focus{border-color:#4ca7e8}.bpi-searching{padding:5px 8px;color:#9ab1ca;font-size:10px}
    .bpi-mode{border:1px solid #4b5567;border-radius:5px;background:#171b22;color:#eef3fb;padding:5px 6px;font-size:11px;outline:none}.bpi-mode:focus{border-color:#4ca7e8}.bpi-mode-info{color:#87bfea}
    .bpi-summary{color:#aab5c5;font-size:11px;min-height:17px}.bpi-status{margin-left:auto}.bpi-status[data-kind="error"]{color:#ff8b93}.bpi-status[data-kind="ok"]{color:#7fdda2}.bpi-status[data-kind="busy"]{color:#ffd27a}
    .bpi-issues{display:none;max-height:105px;overflow:auto;border:1px solid #5b4a36;border-radius:6px;background:rgba(55,39,25,.55);padding:4px 6px}.bpi-issues.bpi-visible{display:block}.bpi-issue{padding:2px 4px;color:#e6c792}.bpi-issue[data-severity="error"]{color:#ff9299}.bpi-issue[data-severity="info"]{color:#86c8eb}.bpi-issue::before{content:"⚠ ";}.bpi-issue[data-severity="error"]::before{content:"⛔ ";}.bpi-issue[data-severity="info"]::before{content:"ℹ ";}
    .bpi-results{display:none;max-height:130px;overflow:auto;border:1px solid #414b5c;border-radius:6px;background:#171b22}.bpi-results.bpi-visible{display:block}.bpi-result{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:7px;padding:5px 7px;border-bottom:1px solid #2d3541;cursor:pointer}.bpi-result:last-child{border-bottom:0}.bpi-result:hover{background:#29384a}.bpi-result-en{color:#e7f1ff}.bpi-result-zh{color:#9ed0ff}.bpi-category{color:#8794a8;font-size:10px;white-space:nowrap}
    .bpi-table{height:300px;min-height:180px;max-height:360px;flex:1 1 300px;overflow-x:hidden;overflow-y:scroll;scrollbar-gutter:stable;border:1px solid #3c4553;border-radius:6px;background:#11151b}.bpi-head,.bpi-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:1px}.bpi-head{position:sticky;top:0;z-index:2;background:#252c36;color:#b9c4d4;font-weight:700}.bpi-head>div,.bpi-cell{padding:6px 8px}.bpi-head>div+div,.bpi-cell+.bpi-cell{border-left:1px solid #3c4553}
    .bpi-row{border-top:1px solid #29313d;cursor:pointer}.bpi-row:hover,.bpi-row.bpi-pinned{background:#314b68}.bpi-row:hover .bpi-cell,.bpi-row.bpi-pinned .bpi-cell{color:#fff}.bpi-row.bpi-unknown{background:rgba(112,70,28,.18)}.bpi-row.bpi-machine{background:rgba(85,62,131,.22)}.bpi-row.bpi-has-warning{box-shadow:inset 3px 0 #d39845}.bpi-row.bpi-has-error{box-shadow:inset 3px 0 #e35b66}
    .bpi-cell{min-width:0;word-break:break-word;display:flex;align-items:flex-start;gap:5px}.bpi-en{color:#e6edf7;font-family:Consolas,monospace}.bpi-zh{color:#9ed0ff}.bpi-row:hover .bpi-en,.bpi-row:hover .bpi-zh,.bpi-row.bpi-pinned .bpi-en,.bpi-row.bpi-pinned .bpi-zh{color:#fff;text-shadow:0 0 7px rgba(109,190,255,.6)}
    .bpi-badge{flex:none;border:1px solid #526075;border-radius:8px;padding:0 5px;color:#aab6c9;font-size:9px;line-height:15px}.bpi-source{border-color:#3e6f67;color:#86d5c4}.bpi-confidence-high{border-color:#3f785c;color:#85d5a6}.bpi-confidence-medium{border-color:#8a7538;color:#e2ca78}.bpi-confidence-low,.bpi-confidence-none{border-color:#7a4c55;color:#ee9ca8}.bpi-unknown .bpi-badge{color:#ffc277;border-color:#85602f}.bpi-machine .bpi-badge{color:#cbb1ff;border-color:#6b5594}.bpi-inline-actions{display:flex;gap:3px;margin-left:auto;flex-wrap:wrap}.bpi-mini{border:1px solid #526075;border-radius:4px;background:#252e3b;color:#dbe7f6;padding:1px 5px;cursor:pointer;font-size:9px}.bpi-mini:hover{background:#3c4b60}.bpi-inline-editor{min-width:90px;flex:1;border:1px solid #4ca7e8;border-radius:4px;background:#141a22;color:#eaf3ff;padding:3px 5px}.bpi-empty{padding:24px;text-align:center;color:#7f8a9a}
    .bpi-filters{display:flex;gap:4px;align-items:center;flex-wrap:wrap}.bpi-filter-active{background:#365f84;border-color:#5792c4;color:#fff}.bpi-star{color:#8f9aaa}.bpi-star.bpi-starred{color:#ffd45f;border-color:#8f772f}.bpi-result.bpi-result-selected{background:#314b68;outline:1px solid #5688b5}.bpi-result-star{font-size:14px;color:#8995a8;align-self:center}.bpi-result-star.bpi-starred{color:#ffd45f}
    .bpi-modal-shade{position:fixed;inset:0;z-index:10020;background:rgba(0,0,0,.58);display:flex;align-items:center;justify-content:center}.bpi-modal{width:min(520px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;background:#20252d;color:#edf2f9;border:1px solid #596577;border-radius:10px;padding:16px;box-shadow:0 18px 55px rgba(0,0,0,.55)}.bpi-modal h3{margin:0 0 12px;font-size:16px}.bpi-form{display:grid;grid-template-columns:92px minmax(0,1fr);gap:9px;align-items:center}.bpi-form label{color:#b7c1cf}.bpi-form input,.bpi-form select,.bpi-form textarea{box-sizing:border-box;width:100%;border:1px solid #4c586b;border-radius:5px;background:#14181f;color:#eef3fa;padding:6px 7px}.bpi-form textarea{min-height:112px;resize:vertical;font:11px/1.45 Arial,sans-serif}.bpi-form input:focus,.bpi-form select:focus,.bpi-form textarea:focus{outline:none;border-color:#4ca7e8}.bpi-modal-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:14px;flex-wrap:wrap}.bpi-weight-presets{display:flex;gap:5px;flex-wrap:wrap;margin-top:10px}.bpi-about-modal{width:min(460px,calc(100vw - 32px))}.bpi-about-name{margin-bottom:7px;color:#d7e9f8;font-weight:700}.bpi-assistant-settings{width:min(820px,calc(100vw - 32px))}.bpi-config-note{color:#98a7b9;font-size:10px;word-break:break-all}.bpi-preview-text{box-sizing:border-box;width:100%;min-height:130px;max-height:300px;resize:vertical;border:1px solid #485467;border-radius:6px;background:#12171e;color:#e7eef8;padding:8px;font:12px/1.5 monospace}.bpi-sort-groups{max-height:230px;overflow:auto;border:1px solid #3e4958;border-radius:6px;background:#151a21;padding:6px;margin:8px 0}.bpi-sort-group{display:grid;grid-template-columns:145px minmax(0,1fr);gap:7px;padding:4px;border-top:1px solid #29313c}.bpi-sort-group:first-child{border-top:0}.bpi-sort-group strong{color:#9fd3ff}
    .bpi-about-footer{flex:none;min-height:20px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:1px 4px 0;color:#6f7a89;font-size:9px}.bpi-about-button{border:0;background:transparent;color:#8096ab;padding:1px 3px;cursor:pointer;font-size:9px}.bpi-about-button:hover{color:#b8dcfa;text-decoration:underline}
    .bpi-manager{width:min(1080px,calc(100vw - 34px));height:min(760px,calc(100vh - 42px));display:flex;flex-direction:column;overflow:hidden}.bpi-manager-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:9px}.bpi-manager-head h3{margin:0 auto 0 0}.bpi-manager-search{flex:1;min-width:180px}.bpi-manager-table{min-height:250px;flex:1;overflow:auto;border:1px solid #465163;border-radius:6px;background:#131820}.bpi-manager-row{display:grid;grid-template-columns:28px minmax(130px,1.1fr) minmax(130px,1.1fr) 110px 105px minmax(180px,1.4fr);gap:1px;border-top:1px solid #2b3441;align-items:center}.bpi-manager-row:first-child{border-top:0}.bpi-manager-row>div{padding:6px 7px;min-width:0;word-break:break-word}.bpi-manager-row.bpi-manager-header{position:sticky;top:0;z-index:2;background:#29313c;color:#c6d1df;font-weight:700}.bpi-manager-row.bpi-manager-selected{background:#2b465f}.bpi-manager-insertable{cursor:pointer;border-radius:4px}.bpi-manager-insertable:hover{background:#30465e;color:#fff}.bpi-manager-actions{display:flex;gap:4px;flex-wrap:wrap}.bpi-manager-summary{color:#aab6c6;margin:7px 0}.bpi-manager-footer{display:flex;gap:6px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-top:9px}.bpi-import-conflicts{max-height:240px;overflow:auto;border:1px solid #4b5567;border-radius:6px;margin-top:10px}.bpi-import-conflict{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;padding:6px;border-top:1px solid #323b48}.bpi-import-conflict:first-child{border-top:0}.bpi-import-stat{display:flex;gap:12px;flex-wrap:wrap;color:#c8d2df}.bpi-danger-text{color:#ff9ba3}
    .bpi-pack-section{border:1px solid #465163;border-radius:7px;background:#151a21;padding:7px;margin-bottom:8px}.bpi-pack-toolbar{display:flex;gap:6px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:6px}.bpi-pack-toolbar strong{color:#d7e2ef}.bpi-pack-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(225px,1fr));gap:5px;max-height:166px;overflow:auto}.bpi-pack-card{border:1px solid #394454;border-radius:6px;background:#202731;padding:6px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:6px;align-items:start}.bpi-pack-card.bpi-pack-disabled{opacity:.58}.bpi-pack-name{font-weight:700;color:#e3edf8}.bpi-pack-meta{font-size:10px;color:#9ba9ba;margin-top:2px;word-break:break-word}.bpi-pack-controls{display:flex;gap:3px;flex-wrap:wrap;justify-content:flex-end}.bpi-switch{margin-top:3px}.bpi-pack-personal{border-color:#397062}.bpi-community-form{display:grid;grid-template-columns:105px minmax(0,1fr);gap:8px;align-items:center}.bpi-community-form input{border:1px solid #4b5668;border-radius:5px;background:#141920;color:#edf3fb;padding:6px}.bpi-community-preview{max-height:150px;overflow:auto;border:1px solid #3d4757;border-radius:5px;padding:5px;margin-top:8px;color:#aeb9c8}
  `;
  document.head.appendChild(style);
}

async function runInspectorAssistant(action, text, instruction = "") {
  const response = await bpiFetch(`${API_ROOT}/assistant/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, text, instruction }),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("双语检查器助手没有返回有效结果");
  }
  if (!response.ok || !result.success) {
    throw new Error(result.error || "双语检查器助手处理失败");
  }
  const output = result.data?.text;
  if (!output || typeof output !== "string") throw new Error("双语检查器助手没有返回文本");
  return output.trim();
}

async function getAssistantConfig() {
  const response = await bpiFetch(`${API_ROOT}/assistant/config`);
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || "助手设置读取失败");
  return result.data;
}

async function saveAssistantConfig(payload) {
  const response = await bpiFetch(`${API_ROOT}/assistant/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || "助手设置保存失败");
  return result.data;
}

async function testAssistantConnection() {
  const response = await bpiFetch(`${API_ROOT}/assistant/test`, { method: "POST" });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || "连接测试失败");
  return result.data;
}

async function resetAssistantRules() {
  const response = await bpiFetch(`${API_ROOT}/assistant/reset-rules`, { method: "POST" });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || "恢复默认规则失败");
  return result.data;
}

async function saveTag(tag) {
  const response = await bpiFetch(`${API_ROOT}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tag),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || "标签保存失败");
  return result;
}

async function deletePersonalTag(english) {
  const response = await bpiFetch(`${API_ROOT}/tags/${encodeURIComponent(english)}`, { method: "DELETE" });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || "个人标签删除失败");
  return result;
}

async function importTags(tags, mode = "skip") {
  const response = await bpiFetch(`${API_ROOT}/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags, mode }),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || "词库导入失败");
  return result.data;
}

async function bulkUpdateTags(english, updates) {
  const response = await bpiFetch(`${API_ROOT}/tags/bulk-update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ english, updates }),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || "批量修改失败");
  return result.data;
}

async function setPackEnabled(packId, enabled) {
  const response = await bpiFetch(`${API_ROOT}/packs/${encodeURIComponent(packId)}/enabled`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || "词库包启停失败");
  return result.data;
}

async function lookupLargeDictionary(terms) {
  const response = await bpiFetch(`${API_ROOT}/large/lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ terms }),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || "大型词库识别失败");
  return result.data ?? [];
}

async function searchLargeDictionary(query, limit = 60) {
  const parameters = new URLSearchParams({ q: query, limit: String(limit) });
  const response = await bpiFetch(`${API_ROOT}/large/search?${parameters}`);
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || "大型词库搜索失败");
  return result.data ?? [];
}

async function setLargeDictionaryEnabled(enabled) {
  const response = await bpiFetch(`${API_ROOT}/large/enabled`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || "大型词库启停失败");
  return result.data;
}

async function importCommunityPack(payload, overwrite = false) {
  const response = await bpiFetch(`${API_ROOT}/packs/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload, overwrite }),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || "社区词库包导入失败");
  return result.data;
}

async function deleteCommunityPack(packId) {
  const response = await bpiFetch(`${API_ROOT}/packs/${encodeURIComponent(packId)}`, { method: "DELETE" });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || "社区词库包删除失败");
  return result.data;
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = element("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function exportDictionaryPack(packId, name) {
  const response = await bpiFetch(`${API_ROOT}/packs/${encodeURIComponent(packId)}/export`);
  const payload = await response.json();
  if (!response.ok || payload.success === false) throw new Error(payload.error || "词库包导出失败");
  downloadJson(payload, `bpi-pack-${packId}-${new Date().toISOString().slice(0, 10)}.json`);
  return name;
}

function field(form, labelText, name, value = "", placeholder = "") {
  const label = element("label", "", labelText);
  label.htmlFor = `bpi-field-${name}`;
  const input = element("input");
  input.id = label.htmlFor;
  input.name = name;
  input.value = value ?? "";
  input.placeholder = placeholder;
  form.append(label, input);
  return input;
}

function openTagDialog(initial, onSaved) {
  const shade = element("div", "bpi-modal-shade");
  const modal = element("div", "bpi-modal");
  const title = element("h3", "", initial?.english ? "添加或修改个人标签" : "添加个人标签");
  const form = element("form", "bpi-form");
  const english = field(form, "英文标签", "english", initial?.english, "例如：looking at viewer");
  const chinese = field(form, "中文名称", "chinese", initial?.chinese, "例如：看向镜头");
  const aliases = field(form, "中文别名", "aliases", initial?.aliases?.join("，"), "用逗号分隔");
  const category = field(form, "分类", "category", initial?.category ?? "自定义", "例如：姿势、镜头、风格");
  const models = field(form, "适用模型", "models", initial?.models?.join("，") ?? "general, anima", "用逗号分隔");
  const weight = field(form, "推荐权重", "recommended_weight", initial?.recommended_weight ?? "", "可不填写");
  const notes = field(form, "说明", "notes", initial?.notes, "可不填写");
  const error = element("div", "bpi-status");
  error.dataset.kind = "error";
  error.style.gridColumn = "1 / -1";
  form.appendChild(error);
  const actions = element("div", "bpi-modal-actions");
  const close = () => shade.remove();
  actions.append(
    button("取消", close),
    button("保存到个人词库", () => form.requestSubmit(), "bpi-primary"),
  );
  modal.append(title, form, actions);
  shade.appendChild(modal);
  document.body.appendChild(shade);
  shade.addEventListener("mousedown", (event) => {
    if (event.target === shade) close();
  });
  modal.addEventListener("mousedown", (event) => event.stopPropagation());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    try {
      await saveTag({
        english: english.value,
        chinese: chinese.value,
        aliases: aliases.value,
        category: category.value,
        models: models.value,
        recommended_weight: weight.value,
        notes: notes.value,
        source: initial?.source === "bpi-assistant" ? initial.source : "user",
        verified: initial?.verified ?? true,
      });
      close();
      await onSaved();
    } catch (saveError) {
      error.textContent = saveError.message;
    }
  });
  setTimeout(() => (initial?.english ? chinese : english).focus(), 0);
}

async function openAssistantSettings(onSaved, onStatus) {
  const shade = element("div", "bpi-modal-shade");
  const modal = element("div", "bpi-modal bpi-assistant-settings");
  modal.appendChild(element("h3", "", "双语检查器助手设置"));
  const loading = element("div", "bpi-empty", "正在读取设置…");
  modal.appendChild(loading);
  shade.appendChild(modal);
  document.body.appendChild(shade);
  const close = () => shade.remove();
  shade.addEventListener("mousedown", (event) => { if (event.target === shade) close(); });
  modal.addEventListener("mousedown", (event) => event.stopPropagation());
  try {
    let config = await getAssistantConfig();
    loading.remove();
    const form = element("form", "bpi-form");
    const providerLabel = element("label", "", "服务类型");
    const provider = element("select");
    for (const [value, label] of [
      ["dictionary", "纯词库（无需 API）"],
      ["ollama", "Ollama 本地模型"],
      ["openai_compatible", "OpenAI 兼容 API"],
    ]) {
      const option = element("option", "", label);
      option.value = value;
      provider.appendChild(option);
    }
    provider.value = config.provider;
    form.append(providerLabel, provider);
    const baseUrl = field(form, "API 地址", "assistant-base-url", config.base_url, "Ollama 可留空；兼容接口示例 https://host/v1");
    const model = field(form, "模型名称", "assistant-model", config.model, "例如 qwen3:8b 或服务商模型 ID");
    const apiKey = field(form, "API Key", "assistant-api-key", "", config.api_key_configured ? "已保存；留空保持不变" : "本地 Ollama 可留空");
    apiKey.type = "password";
    const clearLine = element("label", "bpi-manager-head");
    const clearApiKey = element("input");
    clearApiKey.type = "checkbox";
    clearLine.append(clearApiKey, element("span", "", "清除已保存的 API Key"));
    form.append(element("span"), clearLine);
    const temperature = field(form, "温度", "assistant-temperature", config.temperature, "0–2");
    temperature.type = "number";
    temperature.min = "0";
    temperature.max = "2";
    temperature.step = "0.05";
    const timeout = field(form, "超时（秒）", "assistant-timeout", config.timeout_seconds, "5–600");
    timeout.type = "number";
    timeout.min = "5";
    timeout.max = "600";

    const addRule = (label, value) => {
      const labelElement = element("label", "", label);
      const textarea = element("textarea");
      textarea.value = value;
      form.append(labelElement, textarea);
      return textarea;
    };
    const translationRule = addRule("仅翻译规则", config.translation_rule);
    const translateOptimizeRule = addRule("翻译并优化规则", config.translate_optimize_rule);
    const optimizationRule = addRule("优化为 Anima 规则", config.optimization_rule);
    const error = element("div", "bpi-status");
    error.style.gridColumn = "1 / -1";
    form.appendChild(error);
    modal.appendChild(form);
    modal.appendChild(element("div", "bpi-config-note", "设置保存在当前 ComfyUI 用户目录。API Key 不写入工作流、不返回浏览器，并与当前安装及 API 地址绑定。"));

    const payload = () => ({
      provider: provider.value,
      base_url: baseUrl.value.trim(),
      model: model.value.trim(),
      api_key: apiKey.value.trim(),
      clear_api_key: clearApiKey.checked,
      temperature: temperature.value,
      timeout_seconds: timeout.value,
      translation_rule: translationRule.value,
      translate_optimize_rule: translateOptimizeRule.value,
      optimization_rule: optimizationRule.value,
    });
    const actions = element("div", "bpi-modal-actions");
    const resetButton = button("恢复默认规则", () => {
      translationRule.value = config.default_translation_rule;
      translateOptimizeRule.value = config.default_translate_optimize_rule;
      optimizationRule.value = config.default_optimization_rule;
      error.textContent = "已在编辑框恢复默认值，点击保存后生效";
      error.dataset.kind = "ok";
    });
    const testButton = button("保存并测试连接", async () => {
      testButton.disabled = true;
      error.textContent = "正在测试…";
      error.dataset.kind = "busy";
      try {
        config = await saveAssistantConfig(payload());
        const result = await testAssistantConnection();
        error.textContent = `连接正常：${result.message}`;
        error.dataset.kind = "ok";
      } catch (testError) {
        error.textContent = testError.message;
        error.dataset.kind = "error";
      } finally {
        testButton.disabled = false;
      }
    });
    const saveButton = button("保存设置", async () => {
      saveButton.disabled = true;
      try {
        config = await saveAssistantConfig(payload());
        close();
        await onSaved?.(config);
        onStatus?.("助手设置已保存", "ok");
      } catch (saveError) {
        error.textContent = saveError.message;
        error.dataset.kind = "error";
        saveButton.disabled = false;
      }
    }, "bpi-primary");
    actions.append(resetButton, testButton, button("取消", close), saveButton);
    modal.appendChild(actions);
  } catch (error) {
    loading.textContent = error.message;
    loading.classList.add("bpi-danger-text");
    modal.appendChild(element("div", "bpi-modal-actions"));
  }
}

function createPanel(node, textWidget) {
  const panel = element("div", "bpi-panel");
  const englishSection = element("section", "bpi-english-section");
  const englishHead = element("div", "bpi-english-head");
  const englishTitle = element("span", "", "英文提示词（实际输出）");
  const englishHint = element("span", "bpi-english-hint", "空内容时直接编辑");
  const editEnglishButton = element("button", "bpi-button bpi-mini", "完成编辑");
  editEnglishButton.type = "button";
  englishHead.append(englishTitle, englishHint, editEnglishButton);
  const englishTokenView = element("div", "bpi-english-token-view bpi-hidden");
  englishTokenView.tabIndex = 0;
  englishTokenView.setAttribute("role", "textbox");
  englishTokenView.setAttribute("aria-label", "英文提示词标签视图");
  englishTokenView.setAttribute("aria-readonly", "true");
  const englishEditor = element("textarea", "bpi-english-editor");
  englishEditor.placeholder = "输入英文提示词；完成编辑后将显示为可选择和删除的标签。";
  englishSection.append(englishHead, englishTokenView, englishEditor);
  const mirrorSection = element("section", "bpi-mirror-section");
  const mirrorHead = element("div", "bpi-section-head");
  const mirrorTitle = element("span", "", "中文同步编辑（逐标签组合）");
  const mirrorHint = element("span", "bpi-section-hint", "点击联动｜选中后按 Delete 删除");
  const mirrorActions = element("div", "bpi-mirror-actions");
  const editChineseButton = element("button", "bpi-button bpi-mini", "编辑文本");
  const translateChineseButton = element("button", "bpi-button bpi-mini", "仅翻译");
  const translateOptimizeButton = element("button", "bpi-button bpi-mini bpi-primary", "翻译并优化");
  const optimizeChineseButton = element("button", "bpi-button bpi-mini", "优化为 Anima");
  const syncTextButton = element("button", "bpi-button bpi-mini", "同步到英文输出");
  const sortPromptButton = element("button", "bpi-button bpi-mini", "按官方顺序整理");
  const assistantSettingsButton = element("button", "bpi-button bpi-mini", "助手设置");
  for (const control of [editChineseButton, translateChineseButton, translateOptimizeButton, optimizeChineseButton, syncTextButton, sortPromptButton, assistantSettingsButton]) control.type = "button";
  mirrorActions.append(editChineseButton, translateChineseButton, translateOptimizeButton, optimizeChineseButton, syncTextButton, sortPromptButton, assistantSettingsButton);
  mirrorHead.append(mirrorTitle, mirrorHint, mirrorActions);
  const chineseMirror = element("div", "bpi-chinese-mirror");
  chineseMirror.tabIndex = 0;
  chineseMirror.setAttribute("role", "textbox");
  chineseMirror.setAttribute("aria-label", "逐标签中文同步视图");
  chineseMirror.setAttribute("aria-readonly", "true");
  const chineseEditor = element("textarea", "bpi-chinese-editor bpi-hidden");
  chineseEditor.placeholder = "可输入中文、英文或中英混合文本；使用“仅翻译”或“翻译并优化”处理，确认后再单独同步到英文输出。";
  mirrorSection.append(mirrorHead, chineseMirror, chineseEditor);
  const detailsHead = element("div", "bpi-details-head");
  const detailsSummary = element("span", "bpi-details-summary", "正在分析…");
  const detailsBody = element("div", "bpi-details-body");
  let detailsToggle = null;
  const toolbar = element("div", "bpi-toolbar");
  const leftTools = element("div", "bpi-toolbar-group");
  const rightTools = element("div", "bpi-toolbar-group");
  const searchLine = element("div", "bpi-search-line");
  const search = element("input", "bpi-search");
  search.type = "search";
  search.placeholder = "搜索中英标签（含大型词库）；点击结果插入英文";
  const results = element("div", "bpi-results");
  const summary = element("div", "bpi-summary");
  const counts = element("span");
  const modeInfo = element("span", "bpi-mode-info");
  const status = element("span", "bpi-status");
  const issuesPanel = element("div", "bpi-issues");
  const filtersBar = element("div", "bpi-filters");
  const table = element("div", "bpi-table");
  const head = element("div", "bpi-head");
  head.append(element("div", "", "英文原文（实际输出）"), element("div", "", "中文解释（仅供阅读）"));
  table.appendChild(head);
  const aboutFooter = element("div", "bpi-about-footer");
  const aboutButton = element("button", "bpi-about-button", "关于作者");
  aboutButton.type = "button";
  aboutButton.title = "查看作者信息和社区主页";
  aboutButton.addEventListener("mousedown", (event) => event.stopPropagation());
  aboutButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openAuthorAbout();
  });
  aboutFooter.append(element("span", "", `Bilingual Prompt Inspector ${EXTENSION_VERSION}`), aboutButton);

  const importInput = element("input");
  importInput.type = "file";
  importInput.accept = ".json,application/json";
  importInput.style.display = "none";

  const modeSelect = element("select", "bpi-mode");
  for (const [value, label] of [["auto", "自动识别"], ["tags", "标签模式"], ["natural", "自然语言"]]) {
    const option = element("option", "", label);
    option.value = value;
    modeSelect.appendChild(option);
  }

  const state = {
    data: { tags: [], builtin: [], user: [], packs: [] },
    index: new Map(),
    tokens: [],
    machine: panelSyncHub.machineTranslations,
    translating: new Set(),
    pinned: null,
    lastText: null,
    renderTimer: null,
    modePreference: "auto",
    modeInfo: { mode: "tags", reason: "空输入", confidence: "high" },
    issues: [],
    localOverrides: new Map(),
    editing: null,
    preferences: loadPreferences(),
    tableFilter: "all",
    filterButtons: new Map(),
    searchMatches: [],
    searchIndex: -1,
    largeCache: new Map(),
    largeMisses: new Set(),
    largePending: new Set(),
    largeLookupTimer: null,
    largeLookupGeneration: 0,
    largeSearchMatches: [],
    largeSearchQuery: "",
    largeSearchLoading: false,
    largeSearchTimer: null,
    largeSearchGeneration: 0,
    chineseEditing: false,
    englishEditing: !String(textWidget.value ?? "").trim(),
    englishEditingExplicit: false,
    englishEditorDirty: false,
    nativeEnglishContainer: null,
    assistantBusy: false,
    stagedText: null,
    editorInitialized: false,
    undoStack: [],
    redoStack: [],
    boundTextarea: null,
    textareaListeners: null,
    expandedNodeHeight: null,
    collapsedBaseHeight: null,
    collapsedWidgetHeight: COLLAPSED_WIDGET_FALLBACK_HEIGHT,
    resizeFrame: null,
    manualResize: null,
    windowPointerUp: null,
    syncSource: Symbol(`bpi-node-${node.id ?? "unknown"}`),
    managerRefresh: null,
  };

  const setStatus = (message, kind = "") => {
    status.textContent = message;
    status.dataset.kind = kind;
  };

  const persistPreferences = () => {
    savePreferences(state.preferences);
    panelSyncHub.notify("preferences", state.syncSource);
  };
  const autoFitGreenArea = (target, minimum) => {
    if (!target || target.classList.contains("bpi-hidden")) return;
    target.style.height = "auto";
    const height = Math.max(minimum, Math.min(360, Math.ceil(target.scrollHeight + 2)));
    target.style.height = `${height}px`;
    target.style.overflowY = target.scrollHeight > height + 1 ? "auto" : "hidden";
  };
  const autoFitActiveGreenArea = () => requestAnimationFrame(() => {
    autoFitGreenArea(state.chineseEditing ? chineseEditor : chineseMirror, state.chineseEditing ? 110 : 92);
  });
  const hasNodeSize = () => Number.isFinite(Number(node.size?.[0])) && Number.isFinite(Number(node.size?.[1]));
  const inspectorWidget = () => node.widgets?.find((widget) => widget.name === "bilingual_inspector");
  const resizeCornerHit = (elementValue, event) => {
    const bounds = elementValue.getBoundingClientRect();
    return bounds.right - event.clientX <= 24 && bounds.bottom - event.clientY <= 24;
  };
  const resolveDeepestWidget = (widget) => {
    if (typeof widget?.resolveDeepest !== "function") return widget ?? null;
    try {
      return widget.resolveDeepest()?.widget ?? widget;
    } catch {
      return widget;
    }
  };
  const textWidgetTargets = () => {
    const resolved = resolveDeepestWidget(textWidget);
    return [...new Set([textWidget, resolved].filter(Boolean))];
  };
  const applyEnglishEditorHeight = (height) => {
    const value = Math.max(84, Math.min(420, Math.round(Number(height) || 0)));
    englishEditor.style.height = `${value}px`;
    return value;
  };
  const startManualResize = (kind, target, event) => {
    if (event.button !== 0 || !resizeCornerHit(target, event)) return;
    state.manualResize = {
      kind,
      target,
      startHeight: target.offsetHeight,
      startNodeHeight: Number(node.size?.[1]) || 0,
    };
  };
  const finishManualResize = () => {
    const resize = state.manualResize;
    if (!resize) return;
    state.manualResize = null;
    requestAnimationFrame(() => {
      if (!resize.target?.isConnected) return;
      if (resize.kind === "english") {
        const height = applyEnglishEditorHeight(resize.target.offsetHeight);
        const delta = height - resize.startHeight;
        state.preferences = { ...state.preferences, englishInputHeight: height };
        persistPreferences();
        if (hasNodeSize() && Math.abs(delta) > 0.5) {
          node.setSize?.([node.size[0], Math.max(COLLAPSED_NODE_MIN_HEIGHT, resize.startNodeHeight + delta)]);
        }
      }
      node.graph?.change?.();
      node.graph?.setDirtyCanvas?.(true, true);
      app.graph?.setDirtyCanvas?.(true, true);
    });
  };
  state.windowPointerUp = finishManualResize;
  window.addEventListener("pointerup", state.windowPointerUp, true);
  const measureCollapsedWidgetHeight = () => {
    const styles = getComputedStyle(panel);
    const pixels = (name) => Number.parseFloat(styles.getPropertyValue(name)) || 0;
    const height = mirrorSection.offsetHeight
      + englishSection.offsetHeight
      + detailsHead.offsetHeight
      + pixels("padding-top")
      + pixels("padding-bottom")
      + pixels("border-top-width")
      + pixels("border-bottom-width")
      + pixels("row-gap");
    return Math.max(280, Math.min(620, Math.ceil(height + 1)));
  };
  const requestNodeResize = (expanded) => {
    if (state.resizeFrame !== null) cancelAnimationFrame(state.resizeFrame);
    state.resizeFrame = requestAnimationFrame(() => {
      state.resizeFrame = null;
      if (!expanded) {
        state.collapsedWidgetHeight = measureCollapsedWidgetHeight();
        panel.style.setProperty("--bpi-collapsed-height", `${state.collapsedWidgetHeight}px`);
      }
      const width = Math.max(node.size?.[0] ?? 0, 590);
      const computedHeight = node.computeSize?.()?.[1] ?? 0;
      const targetHeight = expanded
        ? Math.max(computedHeight, state.expandedNodeHeight ?? 0, EXPANDED_NODE_DEFAULT_HEIGHT)
        : Math.max(
            state.collapsedBaseHeight === null ? computedHeight : state.collapsedBaseHeight + state.collapsedWidgetHeight,
            COLLAPSED_NODE_MIN_HEIGHT,
          );
      const sizeChanged = Math.abs((node.size?.[0] ?? 0) - width) > 0.5
        || Math.abs((node.size?.[1] ?? 0) - targetHeight) > 0.5;
      if (sizeChanged) {
        node.setSize?.([width, targetHeight]);
        node.graph?.change?.();
      }
      node.graph?.setDirtyCanvas?.(true, true);
      app.graph?.setDirtyCanvas?.(true, true);
    });
  };
  const applyDetailsVisibility = (resizeNode = false) => {
    const expanded = state.preferences.detailsExpanded !== false;
    detailsBody.classList.toggle("bpi-collapsed", !expanded);
    panel.classList.toggle("bpi-details-collapsed", !expanded);
    if (detailsToggle) detailsToggle.textContent = expanded ? "▲ 收起标签管理" : "▼ 展开标签管理";
    if (resizeNode && hasNodeSize()) requestNodeResize(expanded);
  };
  const setDetailsExpanded = (expanded, resizeNode = true) => {
    const previous = state.preferences.detailsExpanded !== false;
    if (previous && !expanded && hasNodeSize()) {
      state.expandedNodeHeight = Math.max(node.size[1] ?? 0, EXPANDED_NODE_DEFAULT_HEIGHT);
      const currentInspectorHeight = Number(inspectorWidget()?.computedHeight);
      state.collapsedBaseHeight = Number.isFinite(currentInspectorHeight) && currentInspectorHeight > 0
        ? Math.max(0, node.size[1] - currentInspectorHeight)
        : null;
    }
    state.preferences = { ...state.preferences, detailsExpanded: Boolean(expanded) };
    persistPreferences();
    applyDetailsVisibility(resizeNode && previous !== Boolean(expanded));
  };
  const isFavorite = (english) => state.preferences.favorites.includes(normalizeKey(english));
  const changeFavorite = (english) => {
    state.preferences = toggleFavorite(state.preferences, english);
    persistPreferences();
  };
  const rememberRecent = (english) => {
    state.preferences = recordRecent(state.preferences, english);
    persistPreferences();
  };
  const setMachineTranslation = (key, value) => {
    state.machine.set(key, value);
    panelSyncHub.notify("machine", state.syncSource);
  };
  const deleteMachineTranslation = (key) => {
    const changed = state.machine.delete(key);
    if (changed) panelSyncHub.notify("machine", state.syncSource);
    return changed;
  };
  const clearMachineTranslations = () => {
    if (!state.machine.size) return;
    state.machine.clear();
    panelSyncHub.notify("machine", state.syncSource);
  };
  const personalTagFor = (english) => state.data.user.find((tag) => normalizeKey(tag.english) === normalizeKey(english));
  const builtinTagFor = (english) => state.data.builtin.find((tag) => normalizeKey(tag.english) === normalizeKey(english));
  const largeDictionaryReady = () => Boolean(state.data.large_dictionary?.available && state.data.large_dictionary?.enabled);
  const rebuildDictionaryIndex = () => {
    const index = buildDictionaryIndex([...state.largeCache.values()]);
    for (const tag of state.data.tags ?? []) index.set(normalizeKey(tag.english), tag);
    state.index = index;
  };

  const copyText = async (value, message = "已复制") => {
    try {
      await navigator.clipboard.writeText(String(value ?? ""));
      setStatus(message, "ok");
    } catch {
      setStatus("浏览器未允许写入剪贴板", "error");
    }
  };

  const findTextarea = () => {
    const resolved = resolveDeepestWidget(textWidget);
    const isEnglishTextarea = (candidate) => candidate?.tagName === "TEXTAREA"
      && candidate !== chineseEditor
      && !candidate.classList.contains("bpi-chinese-editor")
      && !panel.contains(candidate);
    for (const widget of [resolved, textWidget]) {
      for (const candidate of [widget?.inputEl, widget?.element]) {
        if (isEnglishTextarea(candidate)) return candidate;
        const nested = candidate?.querySelector?.("textarea");
        if (isEnglishTextarea(nested)) return nested;
      }
    }
    const nodeContainer = document.querySelector(`[data-node-id="${node.id}"]`);
    if (!nodeContainer) return null;
    const textareaWidgets = (node.widgets ?? []).filter((widget) => {
      if (widget?.hidden || widget?.type === "hidden") return false;
      const target = resolveDeepestWidget(widget);
      return target?.type === "customtext"
        || target?.type === "string"
        || target?.type === "STRING" && target?.options?.multiline
        || target?.inputEl?.tagName === "TEXTAREA"
        || target?.element?.tagName === "TEXTAREA";
    });
    const targetIndex = textareaWidgets.findIndex((widget) => widget === textWidget || resolveDeepestWidget(widget) === resolved);
    const primeTextareas = [...nodeContainer.querySelectorAll("textarea.p-textarea")].filter(isEnglishTextarea);
    const textareas = primeTextareas.length
      ? primeTextareas
      : [...nodeContainer.querySelectorAll("textarea")].filter(isEnglishTextarea);
    if (targetIndex >= 0 && targetIndex < textareas.length) return textareas[targetIndex];
    return textareas.length === 1 ? textareas[0] : null;
  };

  const hideNativeEnglishWidget = () => {
    for (const widget of textWidgetTargets()) {
      widget.computeSize = () => [0, -4];
      widget.options ??= {};
      widget.options.getMinHeight = () => -4;
      widget.options.getMaxHeight = () => -4;
    }
    const textarea = findTextarea();
    if (!textarea) return false;
    textarea.tabIndex = -1;
    textarea.setAttribute("aria-hidden", "true");
    const container = textarea.closest(".p-floatlabel, .dom-widget");
    const nodeContainer = document.querySelector(`[data-node-id="${node.id}"]`);
    const target = container && container !== nodeContainer ? container : textarea;
    target.style.setProperty("display", "none", "important");
    target.style.setProperty("height", "0", "important");
    target.style.setProperty("min-height", "0", "important");
    target.style.setProperty("padding", "0", "important");
    target.style.setProperty("margin", "0", "important");
    target.style.setProperty("border", "0", "important");
    target.style.setProperty("overflow", "hidden", "important");
    state.nativeEnglishContainer = target;
    return true;
  };

  const updateText = (nextText, cursorPosition = null) => {
    textWidget.value = nextText;
    textWidget.callback?.(nextText);
    node.graph?.change?.();
    app.graph?.setDirtyCanvas?.(true, true);
    const textarea = findTextarea();
    if (textarea) {
      textarea.value = nextText;
    }
    if (document.activeElement !== englishEditor) englishEditor.value = nextText;
    if (state.englishEditing && cursorPosition !== null) {
      const cursor = Math.max(0, Math.min(nextText.length, cursorPosition));
      englishEditor.focus({ preventScroll: true });
      englishEditor.setSelectionRange(cursor, cursor);
    }
    scheduleRender(true);
  };

  englishEditor.value = String(textWidget.value ?? "");
  if (state.preferences.englishInputHeight) applyEnglishEditorHeight(state.preferences.englishInputHeight);

  const setEnglishEditing = (editing, explicit = true) => {
    const requested = Boolean(editing);
    if (requested) {
      state.englishEditing = true;
      state.englishEditingExplicit = explicit;
      state.englishEditorDirty = false;
      englishEditor.value = String(textWidget.value ?? "");
      englishEditor.classList.remove("bpi-hidden");
      englishTokenView.classList.add("bpi-hidden");
      editEnglishButton.textContent = "完成编辑";
      englishHint.textContent = "输入期间保持文本模式；完成后解析为标签";
      requestAnimationFrame(() => {
        englishEditor.focus();
        englishEditor.setSelectionRange(englishEditor.value.length, englishEditor.value.length);
      });
      return;
    }
    const nextText = englishEditor.value;
    if (nextText !== String(textWidget.value ?? "")) updateText(nextText);
    if (!nextText.trim()) {
      state.englishEditing = true;
      state.englishEditingExplicit = false;
      englishHint.textContent = "内容为空，请直接输入英文提示词";
      return;
    }
    state.englishEditing = false;
    state.englishEditingExplicit = false;
    state.englishEditorDirty = false;
    englishEditor.classList.add("bpi-hidden");
    englishTokenView.classList.remove("bpi-hidden");
    editEnglishButton.textContent = "编辑文本";
    englishHint.textContent = "点击标签联动；选中后按 Delete 删除";
    scheduleRender(true);
    requestAnimationFrame(() => englishTokenView.focus({ preventScroll: true }));
  };

  const containsChinese = (value) => /[\u3400-\u9fff]/.test(String(value ?? ""));
  const updateStageControls = () => {
    const value = chineseEditor.value.trim();
    const syncable = Boolean(value) && !containsChinese(value);
    syncTextButton.disabled = state.assistantBusy || !state.chineseEditing || !syncable;
    syncTextButton.title = syncable
      ? "预览后把当前英文结果写入上方实际输出"
      : "只有绿色编辑区中的英文结果可以同步到实际输出";
  };
  const setStagedResult = (text, label, requireAnima = false) => {
    const value = String(text ?? "").trim();
    state.chineseEditing = true;
    state.editorInitialized = true;
    state.stagedText = { text: value, label, requireAnima };
    chineseEditor.value = value;
    chineseMirror.classList.add("bpi-hidden");
    chineseEditor.classList.remove("bpi-hidden");
    editChineseButton.textContent = "返回联动";
    mirrorTitle.textContent = `文本处理结果：${label}`;
    mirrorHint.textContent = containsChinese(value)
      ? "中文结果仅供阅读；如需生图，请继续翻译或优化"
      : "结果尚未写入模型；确认后点击“同步到英文输出”";
    updateStageControls();
    autoFitActiveGreenArea();
  };

  const applyFullText = (nextText, label) => {
    const before = String(textWidget.value ?? "");
    const after = String(nextText ?? "").trim();
    if (!after) {
      setStatus("结果为空，未覆盖英文提示词", "error");
      return false;
    }
    if (before === after) {
      setStatus("内容没有变化", "ok");
      return false;
    }
    state.undoStack.push({
      before,
      after,
      beforeStart: 0,
      beforeEnd: before.length,
      afterCursor: after.length,
      label,
    });
    if (state.undoStack.length > 50) state.undoStack.shift();
    state.redoStack = [];
    state.pinned = null;
    state.chineseEditing = false;
    state.editorInitialized = false;
    state.stagedText = null;
    chineseEditor.classList.add("bpi-hidden");
    chineseMirror.classList.remove("bpi-hidden");
    editChineseButton.textContent = "编辑文本";
    mirrorTitle.textContent = "中文同步编辑（逐标签组合）";
    mirrorHint.textContent = "点击联动｜选中后按 Delete 删除";
    state.englishEditing = false;
    state.englishEditingExplicit = false;
    state.englishEditorDirty = false;
    englishEditor.value = after;
    englishEditor.classList.add("bpi-hidden");
    englishTokenView.classList.remove("bpi-hidden");
    editEnglishButton.textContent = "编辑文本";
    englishHint.textContent = "点击标签联动；选中后按 Delete 删除";
    updateStageControls();
    updateText(after);
    setStatus(`已应用${label}；按 Ctrl+Z 可撤销`, "ok");
    return true;
  };

  const openTextPreview = (title, proposed, detailNode, label) => {
    const shade = element("div", "bpi-modal-shade");
    const modal = element("div", "bpi-modal bpi-assistant-settings");
    modal.appendChild(element("h3", "", title));
    modal.appendChild(element("div", "bpi-config-note", "当前英文提示词"));
    const before = element("textarea", "bpi-preview-text");
    before.readOnly = true;
    before.value = String(textWidget.value ?? "");
    modal.appendChild(before);
    modal.appendChild(element("div", "bpi-config-note", "准备应用的新英文提示词"));
    const after = element("textarea", "bpi-preview-text");
    after.readOnly = true;
    after.value = String(proposed ?? "").trim();
    modal.appendChild(after);
    if (detailNode) modal.appendChild(detailNode);
    const actions = element("div", "bpi-modal-actions");
    const close = () => shade.remove();
    actions.append(button("取消", close), button("确认写入英文", () => {
      if (applyFullText(after.value, label)) close();
    }, "bpi-primary"));
    modal.appendChild(actions);
    shade.appendChild(modal);
    document.body.appendChild(shade);
    shade.addEventListener("mousedown", (event) => { if (event.target === shade) close(); });
    modal.addEventListener("mousedown", (event) => event.stopPropagation());
  };

  const revealLinkedToken = (token) => {
    if (!token) return;
    table.querySelector(`.bpi-row[data-token-id="${token.id}"]`)?.scrollIntoView?.({ block: "nearest" });
    chineseMirror.querySelector(`.bpi-mirror-token[data-token-id="${token.id}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    englishTokenView.querySelector(`.bpi-english-token[data-token-id="${token.id}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  };

  const activateToken = (token) => {
    if (!token) return;
    state.pinned = token.id;
    render();
    requestAnimationFrame(() => {
      revealLinkedToken(token);
    });
  };

  const deleteTokenOccurrence = (token) => {
    if (!["tags", "mixed"].includes(state.modeInfo.mode) || token.segmentKind === "natural") {
      setStatus("自然语言片段仅支持整段编辑；标签可继续逐项删除", "error");
      return;
    }
    const before = String(textWidget.value ?? "");
    const result = removePromptToken(before, token);
    if (!result.changed) return;
    state.undoStack.push({
      before,
      after: result.text,
      beforeStart: token.start,
      beforeEnd: token.end,
      afterCursor: result.cursor,
      label: `删除“${token.term}”`,
    });
    if (state.undoStack.length > 50) state.undoStack.shift();
    state.redoStack = [];
    state.pinned = null;
    updateText(result.text, result.cursor);
    setStatus(`已删除“${token.term}”；按 Ctrl+Z 可撤销`, "ok");
  };

  const applyTokenWeight = (token, weight) => {
    const before = String(textWidget.value ?? "");
    const result = replacePromptTokenWeight(before, token, weight);
    if (!result.changed) {
      setStatus(weight === null ? "该标签当前没有显式权重" : "权重没有变化或数值无效", "error");
      return false;
    }
    const action = weight === null
      ? `清除“${token.term}”的权重`
      : `将“${token.term}”权重设为 ${Number(weight)}`;
    state.undoStack.push({
      before,
      after: result.text,
      beforeStart: token.start,
      beforeEnd: token.end,
      afterCursor: result.cursor,
      label: action,
    });
    if (state.undoStack.length > 50) state.undoStack.shift();
    state.redoStack = [];
    state.pinned = null;
    updateText(result.text, result.cursor);
    setStatus(`已${action}；按 Ctrl+Z 可撤销`, "ok");
    return true;
  };

  const openWeightEditor = (token) => {
    if (!token || token.syntax !== "tag" || token.segmentKind === "natural" ||
        !["tags", "mixed"].includes(state.modeInfo.mode)) {
      setStatus("只有标签支持单独设置权重；自然语言请使用文本编辑", "error");
      return;
    }
    const shade = element("div", "bpi-modal-shade");
    const modal = element("div", "bpi-modal");
    modal.appendChild(element("h3", "", "修改标签权重"));
    modal.appendChild(element("div", "bpi-config-note", `标签：${token.term}｜Anima 格式：(标签:权重)`));
    const form = element("div", "bpi-form");
    const input = element("input", "");
    input.type = "number";
    input.min = "0";
    input.max = "3";
    input.step = "0.05";
    input.value = token.weight === null ? "1" : String(token.weight);
    form.append(element("label", "", "权重"), input);
    modal.appendChild(form);

    const presets = element("div", "bpi-weight-presets");
    for (const value of [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5]) {
      presets.appendChild(button(String(value), () => {
        input.value = String(value);
        input.focus();
      }, "bpi-mini"));
    }
    modal.appendChild(presets);

    const close = () => shade.remove();
    const apply = () => {
      const numeric = Number(input.value);
      if (!input.value.trim() || !Number.isFinite(numeric) || numeric < 0 || numeric > 3) {
        setStatus("权重必须是 0 到 3 之间的数字", "error");
        input.focus();
        return;
      }
      if (applyTokenWeight(token, numeric)) close();
    };
    const actions = element("div", "bpi-modal-actions");
    if (token.weight !== null) {
      actions.appendChild(button("清除权重", () => {
        if (applyTokenWeight(token, null)) close();
      }, "bpi-danger"));
    }
    actions.append(button("取消", close), button("应用权重", apply, "bpi-primary"));
    modal.appendChild(actions);
    shade.appendChild(modal);
    document.body.appendChild(shade);
    shade.addEventListener("mousedown", (event) => { if (event.target === shade) close(); });
    modal.addEventListener("mousedown", (event) => event.stopPropagation());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        apply();
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    });
    setTimeout(() => { input.focus(); input.select(); }, 0);
  };

  const undoStructuredEdit = () => {
    const entry = state.undoStack.at(-1);
    if (!entry || String(textWidget.value ?? "") !== entry.after) return false;
    state.undoStack.pop();
    state.redoStack.push(entry);
    state.pinned = null;
    updateText(entry.before, entry.beforeStart);
    setStatus(`已撤销：${entry.label}`, "ok");
    return true;
  };

  const redoStructuredEdit = () => {
    const entry = state.redoStack.at(-1);
    if (!entry || String(textWidget.value ?? "") !== entry.before) return false;
    state.redoStack.pop();
    state.undoStack.push(entry);
    state.pinned = null;
    updateText(entry.after, entry.afterCursor);
    setStatus(`已重做：${entry.label}`, "ok");
    return true;
  };

  const handleHistoryShortcut = (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const redo = key === "y" || (key === "z" && event.shiftKey);
    const handled = redo ? redoStructuredEdit() : key === "z" ? undoStructuredEdit() : false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const bindTextareaEvents = () => {
    const textarea = findTextarea();
    if (!textarea) return;
    if (state.boundTextarea && state.textareaListeners) {
      for (const [name, listener] of state.textareaListeners) state.boundTextarea.removeEventListener(name, listener);
      state.boundTextarea.classList.remove("bpi-english-resizable", "bpi-english-linked");
    }
    state.boundTextarea = textarea;
    state.textareaListeners = [];
    hideNativeEnglishWidget();
  };

  const insertEnglish = (english, keepSearch = false) => {
    const current = String(textWidget.value ?? "");
    const start = state.englishEditing ? (englishEditor.selectionStart ?? current.length) : current.length;
    const end = state.englishEditing ? (englishEditor.selectionEnd ?? start) : start;
    const before = current.slice(0, start);
    const after = current.slice(end);
    const needsPrefix = before.trim() && !/[\s,\n]$/.test(before);
    const needsSuffix = after.trim() && !/^[\s,\n]/.test(after);
    const insertion = `${needsPrefix ? ", " : ""}${english}${needsSuffix ? ", " : ""}`;
    const nextText = before + insertion + after;
    updateText(nextText, state.englishEditing ? start + insertion.length : null);
    rememberRecent(english);
    if (!keepSearch) search.value = "";
    renderSearch();
  };

  const queueLargeLookup = (tokens) => {
    if (!largeDictionaryReady() || !["tags", "mixed"].includes(state.modeInfo.mode)) return;
    const candidates = [];
    const seen = new Set();
    for (const token of tokens ?? []) {
      if (token.segmentKind === "natural" || token.status !== "unknown" || token.syntax !== "tag" || /[\u3400-\u9fff]/.test(token.term)) continue;
      if (!token.key || seen.has(token.key) || state.largeCache.has(token.key) || state.largeMisses.has(token.key) || state.largePending.has(token.key)) continue;
      seen.add(token.key);
      candidates.push({ key: token.key, term: token.term });
    }
    if (!candidates.length) return;
    clearTimeout(state.largeLookupTimer);
    state.largeLookupTimer = setTimeout(async () => {
      const batch = candidates.slice(0, 200);
      const generation = state.largeLookupGeneration;
      for (const item of batch) state.largePending.add(item.key);
      try {
        const matches = await lookupLargeDictionary(batch.map((item) => item.term));
        if (generation !== state.largeLookupGeneration) return;
        const found = new Set();
        for (const tag of matches) {
          const key = normalizeKey(tag.english);
          found.add(key);
          state.largeCache.set(key, tag);
          state.largeMisses.delete(key);
        }
        for (const item of batch) if (!found.has(item.key)) state.largeMisses.add(item.key);
        rebuildDictionaryIndex();
        render();
      } catch (error) {
        console.warn("[BilingualPromptInspector] 大型词库批量识别失败", error);
        setStatus(error.message, "error");
      } finally {
        for (const item of batch) state.largePending.delete(item.key);
      }
    }, 300);
  };

  const resetLargeRuntimeCache = () => {
    clearTimeout(state.largeLookupTimer);
    clearTimeout(state.largeSearchTimer);
    state.largeLookupGeneration += 1;
    state.largeSearchGeneration += 1;
    state.largeCache.clear();
    state.largeMisses.clear();
    state.largePending.clear();
    state.largeSearchMatches = [];
    state.largeSearchQuery = "";
    state.largeSearchLoading = false;
  };

  const refreshDictionary = async (notifyPeers = true) => {
    setStatus("正在读取词库…", "busy");
    try {
      state.data = await loadDictionary(true);
      resetLargeRuntimeCache();
      rebuildDictionaryIndex();
      const large = state.data.large_dictionary;
      const largeText = large?.available
        ? `｜大型库 ${large.count} 项（${large.enabled ? "按需启用" : "已停用"}）`
        : "｜大型库未安装";
      setStatus(`常用词库 ${state.data.tags.length} 项${largeText}`, "ok");
      render();
      renderSearch();
      if (notifyPeers) panelSyncHub.notify("dictionary", state.syncSource);
    } catch (error) {
      setStatus(error.message, "error");
      state.data = { tags: [], builtin: [], user: [], packs: [], large_dictionary: null };
      resetLargeRuntimeCache();
      state.index = new Map();
      render();
    }
  };

  const saveMachineTranslation = (token) => {
    openTagDialog({
      english: token.term,
      chinese: token.chinese,
      category: "待整理",
      models: ["general", "anima"],
      source: "bpi-assistant",
      verified: true,
    }, async () => {
      deleteMachineTranslation(token.key);
      await refreshDictionary();
    });
  };

  const beginInlineEdit = (token) => {
    state.editing = {
      id: token.id,
      key: token.key,
      value: ["未收录", "自然语言片段（待翻译或确认）"].includes(token.chinese) ? "" : token.chinese,
    };
    render();
  };

  const applyInlineEdit = async (token, value, persist) => {
    const chinese = String(value ?? "").trim();
    if (!chinese) {
      setStatus("中文解释不能为空", "error");
      return;
    }
    if (!persist) {
      state.localOverrides.set(token.key, { text: chinese, source: "session" });
      state.editing = null;
      setStatus(`已临时修改“${token.term}”，不会写入词库`, "ok");
      render();
      return;
    }
    try {
      const entry = token.entry ?? {};
      await saveTag({
        english: token.term,
        chinese,
        aliases: entry.aliases ?? [],
        category: entry.category ?? "自定义",
        models: entry.models ?? ["general", "anima"],
        recommended_weight: entry.recommended_weight ?? "",
        notes: entry.notes ?? "",
        source: "user",
        verified: true,
      });
      state.localOverrides.delete(token.key);
      deleteMachineTranslation(token.key);
      state.editing = null;
      await refreshDictionary();
      setStatus(`已将“${token.term}”保存到个人词库`, "ok");
    } catch (error) {
      setStatus(error.message, "error");
    }
  };

  const translateToken = async (token) => {
    if (!token?.key || state.translating.has(token.key)) return;
    state.translating.add(token.key);
    setStatus(`正在翻译：${token.term}`, "busy");
    render();
    try {
      const naturalLanguage = token.segmentKind === "natural" || ["natural", "instruction"].includes(token.inputMode);
      const translated = await runInspectorAssistant(
        "translate",
        token.term,
        naturalLanguage ? "这是自然语言片段，请保持为自然语言译文，不要拆成标签列表。" : "",
      );
      const validation = validateTranslationResult(token.term, translated, { naturalLanguage });
      if (!validation.ok) {
        console.warn("[BilingualPromptInspector] 已拒绝异常机器译文", {
          source: token.term,
          translated,
          reason: validation.reason,
        });
        setStatus(`已拒绝异常译文：${validation.reason}`, "error");
        return false;
      }
      setMachineTranslation(token.key, {
        english: token.term,
        text: validation.text,
        source: "bpi-assistant",
        createdAt: Date.now(),
      });
      setStatus(`已翻译“${token.term}”，确认后可保存`, "ok");
      return true;
    } catch (error) {
      setStatus(error.message, "error");
      return false;
    } finally {
      state.translating.delete(token.key);
      render();
    }
  };

  const chineseDraftFromTokens = () => state.tokens.map((token) => {
    if (token.syntax === "special" || token.syntax === "operator") return token.raw;
    const label = token.status === "unknown" ? token.term : token.chinese;
    return token.weight === null ? label : `(${label}:${token.weight})`;
  }).join("，");

  const setChineseEditing = (editing) => {
    state.chineseEditing = Boolean(editing);
    chineseMirror.classList.toggle("bpi-hidden", state.chineseEditing);
    chineseEditor.classList.toggle("bpi-hidden", !state.chineseEditing);
    editChineseButton.textContent = state.chineseEditing ? "返回联动" : "编辑文本";
    mirrorTitle.textContent = state.chineseEditing ? "文本编辑与处理（支持中英混合）" : "中文同步编辑（逐标签组合）";
    mirrorHint.textContent = state.chineseEditing ? "处理结果留在此处；点击同步才写入上方英文" : "点击联动｜选中后按 Delete 删除";
    if (state.chineseEditing) {
      if (!state.editorInitialized) {
        chineseEditor.value = chineseDraftFromTokens();
        state.editorInitialized = true;
        state.stagedText = null;
      }
      requestAnimationFrame(() => {
        autoFitGreenArea(chineseEditor, 110);
        chineseEditor.focus();
        chineseEditor.setSelectionRange(chineseEditor.value.length, chineseEditor.value.length);
      });
    } else {
      autoFitActiveGreenArea();
    }
    updateStageControls();
    if (hasNodeSize()) requestNodeResize(state.preferences.detailsExpanded !== false);
  };

  const setAssistantBusy = (busy) => {
    state.assistantBusy = Boolean(busy);
    translateChineseButton.disabled = state.assistantBusy;
    translateOptimizeButton.disabled = state.assistantBusy;
    optimizeChineseButton.disabled = state.assistantBusy;
    sortPromptButton.disabled = state.assistantBusy;
    updateStageControls();
  };

  const runTextAssistant = async (action) => {
    if (state.assistantBusy) return;
    if (!state.chineseEditing) setChineseEditing(true);
    const source = chineseEditor.value.trim();
    if (!source) {
      setStatus("请先在绿色文本编辑框输入内容", "error");
      return;
    }
    if (action === "optimize" && containsChinese(source)) {
      setStatus("“优化为 Anima”只处理英文；中文或混合内容请使用“翻译并优化”", "error");
      return;
    }
    setAssistantBusy(true);
    const labels = {
      translate: "仅翻译",
      translate_optimize: "翻译并优化",
      optimize: "优化为 Anima",
    };
    const label = labels[action];
    setStatus(`正在执行${label}…`, "busy");
    try {
      const output = await runInspectorAssistant(action, source);
      setStagedResult(output, label, action !== "translate");
      setStatus(`${label}已完成；结果尚未同步到上方英文输出`, "ok");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      setAssistantBusy(false);
    }
  };

  const syncEditedText = () => {
    const proposed = chineseEditor.value.trim();
    if (!proposed) {
      setStatus("绿色文本编辑框为空", "error");
      return;
    }
    if (containsChinese(proposed)) {
      setStatus("当前结果包含中文，不能同步到英文模型输入", "error");
      return;
    }
    if (state.stagedText?.requireAnima) {
      const punctuationError = animaPunctuationError(proposed);
      if (punctuationError) {
        setStatus(`${punctuationError}，请修改后再同步`, "error");
        return;
      }
    }
    const label = state.stagedText?.label ? `${state.stagedText.label}同步` : "文本同步";
    openTextPreview("同步到英文输出", proposed, null, label);
  };

  const ensureLargeEntriesFor = async (tokens) => {
    if (!largeDictionaryReady()) return;
    const pending = [];
    const seen = new Set();
    for (const token of tokens) {
      if (token.syntax !== "tag" || token.entry || !token.key || seen.has(token.key) || /[\u3400-\u9fff]/.test(token.term)) continue;
      seen.add(token.key);
      pending.push(token.term);
    }
    if (!pending.length) return;
    const matches = await lookupLargeDictionary(pending.slice(0, 200));
    for (const tag of matches) state.largeCache.set(normalizeKey(tag.english), tag);
    rebuildDictionaryIndex();
  };

  const sortByAnimaOrder = async () => {
    if (state.assistantBusy) return;
    const source = String(textWidget.value ?? "").trim();
    if (!source) {
      setStatus("英文提示词为空，无法整理", "error");
      return;
    }
    setAssistantBusy(true);
    setStatus("正在识别标签分类…", "busy");
    try {
      let tokens = parsePrompt(source, state.index, state.machine, { mode: "tags" });
      await ensureLargeEntriesFor(tokens);
      tokens = parsePrompt(source, state.index, state.machine, { mode: "tags" });
      const result = sortAnimaPrompt(tokens);
      if (result.text === source) {
        setStatus(`已经符合 Anima 顺序${result.uncertain.length ? `｜待确认分类 ${result.uncertain.length} 项` : ""}`, "ok");
        return;
      }
      const groups = element("div", "bpi-sort-groups");
      for (const group of result.groups) {
        const row = element("div", "bpi-sort-group");
        row.append(element("strong", "", group.label), element("span", "", group.tokens.map((token) => token.raw.trim()).join("，")));
        groups.appendChild(row);
      }
      groups.prepend(element("div", "bpi-config-note", `已重新定位 ${result.moved} 项｜待确认分类 ${result.uncertain.length} 项。排序只移动标签，不改写内容。`));
      openTextPreview("Anima 官方顺序整理预览", result.text, groups, "官方顺序整理");
      setStatus("排序完成，请在预览窗口确认", "ok");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      setAssistantBusy(false);
    }
  };

  const renderEnglishTokenView = (text) => {
    const hasText = Boolean(text.trim());
    if (!hasText && !state.englishEditing) {
      state.englishEditing = true;
      state.englishEditingExplicit = false;
    }
    englishEditor.classList.toggle("bpi-hidden", !state.englishEditing);
    englishTokenView.classList.toggle("bpi-hidden", state.englishEditing);
    editEnglishButton.textContent = state.englishEditing ? "完成编辑" : "编辑文本";
    englishHint.textContent = state.englishEditing
      ? (hasText ? "输入期间保持文本模式；完成后解析为标签" : "内容为空，请直接输入英文提示词")
      : "点击标签联动；选中后按 Delete 删除";
    if (state.englishEditing) {
      if (document.activeElement !== englishEditor && !state.englishEditorDirty) englishEditor.value = text;
      return;
    }

    englishTokenView.replaceChildren();
    if (!state.tokens.length) {
      englishTokenView.appendChild(element("span", "bpi-mirror-empty", "完成英文编辑后会在这里显示可联动标签。"));
      return;
    }
    for (const [index, token] of state.tokens.entries()) {
      const classes = ["bpi-mirror-token", "bpi-english-token", `bpi-${token.status}`];
      if (state.pinned === token.id) classes.push("bpi-linked");
      const label = token.raw.trim() || token.term;
      const chip = element("span", classes.join(" "), label);
      chip.dataset.tokenId = String(token.id);
      chip.title = token.segmentKind === "natural"
        ? `${token.term} ↔ ${token.chinese}｜自然语言仅支持整段编辑`
        : `${token.term} ↔ ${token.chinese}｜单击联动；双击修改权重；选中后按 Delete 删除`;
      chip.addEventListener("click", (event) => {
        event.stopPropagation();
        activateToken(token);
        englishTokenView.focus({ preventScroll: true });
      });
      chip.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.getSelection()?.removeAllRanges();
        activateToken(token);
        englishTokenView.focus({ preventScroll: true });
        openWeightEditor(token);
      });
      if (state.pinned === token.id && ["tags", "mixed"].includes(state.modeInfo.mode) && token.segmentKind !== "natural") {
        const remove = element("span", "bpi-mirror-delete", "×");
        remove.title = `删除 ${token.term}`;
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          deleteTokenOccurrence(token);
        });
        chip.appendChild(remove);
      }
      englishTokenView.appendChild(chip);
      const next = state.tokens[index + 1];
      if (next) {
        const sourceGap = text.slice(token.end, next.start);
        englishTokenView.appendChild(element("span", "bpi-mirror-separator", /[\r\n]/.test(sourceGap) ? "\n" : ", "));
      }
    }
    requestAnimationFrame(() => autoFitGreenArea(englishTokenView, 92));
  };

  const renderChineseMirror = (text) => {
    chineseMirror.replaceChildren();
    if (!state.tokens.length) {
      chineseMirror.appendChild(element("span", "bpi-mirror-empty", "英文提示词的逐标签中文组合会显示在这里。"));
      autoFitActiveGreenArea();
      return;
    }
    for (const [index, token] of state.tokens.entries()) {
      const classes = ["bpi-mirror-token", `bpi-${token.status}`];
      if (state.pinned === token.id) classes.push("bpi-linked");
      const label = token.status === "unknown"
        ? `⚠ 未收录：${token.term}`
        : `${token.chinese}${token.weight === null ? "" : `（权重 ${token.weight}）`}`;
      const chip = element("span", classes.join(" "), label);
      chip.dataset.tokenId = String(token.id);
      chip.title = token.segmentKind === "natural"
        ? `${token.raw} ↔ ${token.chinese}｜自然语言仅支持整段编辑或翻译`
        : token.status === "unknown"
          ? `未知英文标签：${token.term}｜单击定位；双击修改权重`
          : `${token.raw} ↔ ${token.chinese}｜单击定位；双击修改权重；选中后按 Delete 删除`;
      chip.addEventListener("click", (event) => {
        event.stopPropagation();
        if (token.status === "unknown") state.tableFilter = "unknown";
        if (token.status === "unknown" && state.preferences.detailsExpanded === false) {
          setDetailsExpanded(true);
        }
        activateToken(token);
        chineseMirror.focus({ preventScroll: true });
        if (token.status === "unknown") {
          requestAnimationFrame(() => panel.querySelector(`.bpi-row[data-token-id="${token.id}"]`)?.scrollIntoView?.({ block: "nearest" }));
        }
      });
      chip.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.getSelection()?.removeAllRanges();
        activateToken(token);
        chineseMirror.focus({ preventScroll: true });
        openWeightEditor(token);
      });
      if (state.pinned === token.id && ["tags", "mixed"].includes(state.modeInfo.mode) && token.segmentKind !== "natural") {
        const remove = element("span", "bpi-mirror-delete", "×");
        remove.title = `删除 ${token.term}`;
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          deleteTokenOccurrence(token);
        });
        chip.appendChild(remove);
      }
      chineseMirror.appendChild(chip);
      const next = state.tokens[index + 1];
      if (next) {
        const sourceGap = text.slice(token.end, next.start);
        chineseMirror.appendChild(element("span", "bpi-mirror-separator", /[\r\n]/.test(sourceGap) ? "\n" : "，"));
      }
    }
    autoFitActiveGreenArea();
  };

  const render = () => {
    const text = String(textWidget.value ?? "");
    state.lastText = text;
    state.modeInfo = detectInputMode(text, state.modePreference);
    state.tokens = parsePrompt(text, state.index, state.machine, { mode: state.modePreference }).map((token) => {
      const override = state.localOverrides.get(token.key);
      if (!override) return token;
      return {
        ...token,
        chinese: override.text,
        source: override.source,
        status: "session",
        confidence: "medium",
        confidenceLabel: "中可信·仅本次",
      };
    });
    queueLargeLookup(state.tokens);
    state.issues = analyzePromptSyntax(text, state.tokens, state.modeInfo);
    if (state.pinned !== null && !state.tokens.some((token) => token.id === state.pinned)) state.pinned = null;
    renderEnglishTokenView(text);
    renderChineseMirror(text);
    if (state.preferences.detailsExpanded === false && hasNodeSize()) requestNodeResize(false);
    const personalKeys = new Set(state.data.user.map((tag) => normalizeKey(tag.english)));
    const visibleTokens = state.tokens.filter((token) => {
      if (state.tableFilter === "unknown") return token.status === "unknown";
      if (state.tableFilter === "machine") return token.status === "machine";
      if (state.tableFilter === "personal") return personalKeys.has(token.key);
      if (state.tableFilter === "favorites") return isFavorite(token.term);
      return true;
    });
    const errorsByKey = new Map();
    for (const item of state.issues) {
      for (const key of item.tokenKeys ?? []) {
        const current = errorsByKey.get(key);
        if (current !== "error") errorsByKey.set(key, item.severity);
      }
    }
    issuesPanel.replaceChildren();
    for (const item of state.issues.slice(0, 12)) {
      const issueRow = element("div", "bpi-issue", item.message);
      issueRow.dataset.severity = item.severity;
      issuesPanel.appendChild(issueRow);
    }
    issuesPanel.classList.toggle("bpi-visible", state.issues.length > 0);
    while (table.children.length > 1) table.lastChild.remove();
    if (!state.tokens.length) {
      table.appendChild(element("div", "bpi-empty", "在上方英文文本框输入提示词，这里会显示逐标签中英对应关系。"));
    } else if (!visibleTokens.length) {
      table.appendChild(element("div", "bpi-empty", "当前筛选条件下没有匹配项目。"));
    } else {
      for (const token of visibleTokens) {
        const row = element("div", `bpi-row bpi-${token.status}`);
        const rowSeverity = errorsByKey.get(token.key);
        if (rowSeverity === "error") row.classList.add("bpi-has-error");
        else if (rowSeverity === "warning") row.classList.add("bpi-has-warning");
        row.dataset.tokenId = String(token.id);
        if (state.pinned === token.id) row.classList.add("bpi-pinned");
        const englishCell = element("div", "bpi-cell bpi-en");
        const chineseCell = element("div", "bpi-cell bpi-zh");
        const englishText = element("span", "", token.raw);
        englishText.title = `查询词：${token.term}${token.weight === null ? "" : `｜权重：${token.weight}`}`;
        englishText.addEventListener("dblclick", (event) => {
          event.stopPropagation();
          setEnglishEditing(true);
          requestAnimationFrame(() => {
            englishEditor.focus({ preventScroll: true });
            englishEditor.setSelectionRange(token.start, token.end, "forward");
          });
          setStatus(`已定位：${token.term}`, "ok");
        });
        englishCell.appendChild(englishText);
        const isEditing = state.editing?.id === token.id && state.editing?.key === token.key;
        if (isEditing) {
          const editor = element("input", "bpi-inline-editor");
          editor.value = state.editing.value;
          editor.placeholder = "输入中文解释";
          editor.addEventListener("input", () => { state.editing.value = editor.value; });
          editor.addEventListener("click", (event) => event.stopPropagation());
          editor.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              applyInlineEdit(token, editor.value, false);
            } else if (event.key === "Escape") {
              state.editing = null;
              render();
            }
          });
          chineseCell.appendChild(editor);
          const editActions = element("span", "bpi-inline-actions");
          editActions.append(
            button("仅本次", () => applyInlineEdit(token, editor.value, false), "bpi-mini"),
            button("保存词库", () => applyInlineEdit(token, editor.value, true), "bpi-mini"),
            button("取消", () => { state.editing = null; render(); }, "bpi-mini"),
          );
          chineseCell.appendChild(editActions);
          row.append(englishCell, chineseCell);
          table.appendChild(row);
          setTimeout(() => { editor.focus(); editor.select(); }, 0);
          continue;
        }
        const chineseText = element("span", "", token.chinese);
        chineseText.title = "双击修改中文解释";
        chineseText.addEventListener("dblclick", (event) => {
          event.stopPropagation();
          if (token.syntax === "tag" && token.status !== "special") beginInlineEdit(token);
        });
        chineseCell.appendChild(chineseText);

        const badgeLabels = {
          unknown: "未收录",
          machine: "机器译",
          unverified: "待确认",
          special: "语法",
        };
        if (badgeLabels[token.status]) chineseCell.appendChild(element("span", "bpi-badge", badgeLabels[token.status]));
        if (token.weight !== null) chineseCell.appendChild(element("span", "bpi-badge", `权重 ${token.weight}`));
        const origin = token.entry?.pack_name ?? sourceLabel(token.source, token.status);
        const sourceBadge = element("span", "bpi-badge bpi-source", origin);
        sourceBadge.title = token.status === "machine"
          ? "由双语检查器当前配置的助手生成，尚未写入个人词库"
          : `解释来源：${origin}`;
        chineseCell.appendChild(sourceBadge);
        const confidenceBadge = element("span", `bpi-badge bpi-confidence-${token.confidence}`, token.confidenceLabel);
        confidenceBadge.title = token.status === "machine"
          ? "机器翻译尚未经过人工确认"
          : token.status === "unknown" ? "当前词库无法判断" : "根据词库来源和确认状态估算";
        chineseCell.appendChild(confidenceBadge);

        const actions = element("span", "bpi-inline-actions");
        if (token.status === "unknown" && !/[\u3400-\u9fff]/.test(token.term)) {
          const translating = state.translating.has(token.key);
          const translateButton = element("button", "bpi-mini", translating ? "翻译中" : "翻译");
          translateButton.disabled = translating;
          translateButton.addEventListener("click", (event) => {
            event.stopPropagation();
            translateToken(token);
          });
          actions.appendChild(translateButton);
        } else if (token.status === "unknown" && /[\u3400-\u9fff]/.test(token.term)) {
          const hint = element("span", "bpi-badge", "使用上方“编辑文本”处理");
          hint.title = "点击“编辑文本”，再使用检查器自己的“仅翻译”或“翻译并优化”";
          actions.appendChild(hint);
        } else if (token.status === "machine") {
          const saveButton = element("button", "bpi-mini", "确认并保存");
          saveButton.addEventListener("click", (event) => {
            event.stopPropagation();
            saveMachineTranslation(token);
          });
          const retryButton = element("button", "bpi-mini", "重新翻译");
          retryButton.addEventListener("click", async (event) => {
            event.stopPropagation();
            deleteMachineTranslation(token.key);
            render();
            await translateToken({ ...token, status: "unknown" });
          });
          actions.append(saveButton, retryButton);
        }
        if (token.syntax === "tag" && token.status !== "special") {
          const editButton = element("button", "bpi-mini", "修改中文");
          editButton.addEventListener("click", (event) => {
            event.stopPropagation();
            beginInlineEdit(token);
          });
          actions.appendChild(editButton);
        }
        if (token.key) {
          const favoriteButton = element("button", `bpi-mini bpi-star${isFavorite(token.term) ? " bpi-starred" : ""}`, isFavorite(token.term) ? "★" : "☆");
          favoriteButton.title = isFavorite(token.term) ? "取消收藏" : "收藏";
          favoriteButton.addEventListener("click", (event) => {
            event.stopPropagation();
            changeFavorite(token.term);
            render();
            renderSearch();
          });
          const copyButton = element("button", "bpi-mini", "复制");
          copyButton.title = "复制英文与中文对照";
          copyButton.addEventListener("click", (event) => {
            event.stopPropagation();
            copyText(`${token.raw}\t${token.chinese}`, `已复制“${token.term}”的中英对照`);
          });
          actions.append(favoriteButton, copyButton);
        }
        if (personalKeys.has(token.key)) {
          const hasBuiltin = Boolean(builtinTagFor(token.term));
          const restoreButton = element("button", "bpi-mini", hasBuiltin ? "恢复内置" : "删除个人");
          restoreButton.addEventListener("click", async (event) => {
            event.stopPropagation();
            if (!window.confirm(`${hasBuiltin ? "删除个人覆盖并恢复内置解释" : "删除个人标签"}“${token.term}”？`)) return;
            try {
              await deletePersonalTag(token.term);
              await refreshDictionary();
              setStatus(hasBuiltin ? "已恢复内置解释" : "已删除个人标签", "ok");
            } catch (error) { setStatus(error.message, "error"); }
          });
          actions.appendChild(restoreButton);
        }
        if (actions.children.length) chineseCell.appendChild(actions);
        row.append(englishCell, chineseCell);
        row.addEventListener("click", () => {
          activateToken(token);
        });
        table.appendChild(row);
      }
    }
    const known = state.tokens.filter((token) => ["verified", "unverified", "special", "session"].includes(token.status)).length;
    const unknown = state.tokens.filter((token) => token.status === "unknown").length;
    const machine = state.tokens.filter((token) => token.status === "machine").length;
    const warningCount = state.issues.filter((item) => item.severity !== "info").length;
    counts.textContent = `项目 ${state.tokens.length}｜已识别 ${known}｜未知 ${unknown}${machine ? `｜待确认 ${machine}` : ""}${warningCount ? `｜问题 ${warningCount}` : ""}`;
    detailsSummary.textContent = `${state.tokens.length} 项｜未知 ${unknown}${machine ? `｜待确认 ${machine}` : ""}`;
    const modeLabels = { tags: "标签", mixed: "标签 + 自然语言", natural: "自然语言", instruction: "附带指令" };
    modeInfo.textContent = `模式：${modeLabels[state.modeInfo.mode]}（${state.modeInfo.reason}）`;
    for (const [filter, control] of state.filterButtons) control.classList.toggle("bpi-filter-active", filter === state.tableFilter);
  };

  const scheduleRender = (immediate = false) => {
    clearTimeout(state.renderTimer);
    state.renderTimer = setTimeout(render, immediate ? 0 : 180);
  };

  const renderSearch = () => {
    results.replaceChildren();
    const rawQuery = search.value.trim();
    if (!rawQuery) {
      clearTimeout(state.largeSearchTimer);
      state.largeSearchGeneration += 1;
      state.largeSearchQuery = "";
      state.largeSearchMatches = [];
      state.largeSearchLoading = false;
    } else if (largeDictionaryReady() && rawQuery !== state.largeSearchQuery) {
      clearTimeout(state.largeSearchTimer);
      state.largeSearchQuery = rawQuery;
      state.largeSearchMatches = [];
      state.largeSearchLoading = true;
      const generation = ++state.largeSearchGeneration;
      state.largeSearchTimer = setTimeout(async () => {
        try {
          const found = await searchLargeDictionary(rawQuery, 60);
          if (generation !== state.largeSearchGeneration || search.value.trim() !== rawQuery) return;
          state.largeSearchMatches = found;
          for (const tag of found) state.largeCache.set(normalizeKey(tag.english), tag);
          rebuildDictionaryIndex();
        } catch (error) {
          if (generation === state.largeSearchGeneration) setStatus(error.message, "error");
        } finally {
          if (generation === state.largeSearchGeneration) {
            state.largeSearchLoading = false;
            renderSearch();
          }
        }
      }, 260);
    }
    const localKeys = new Set((state.data.tags ?? []).map((tag) => normalizeKey(tag.english)));
    const searchable = [
      ...(state.data.tags ?? []),
      ...state.largeSearchMatches.filter((tag) => !localKeys.has(normalizeKey(tag.english))),
    ];
    const matches = rawQuery
      ? rankDictionaryTags(searchable, rawQuery, state.preferences, 40)
      : suggestedTags(state.data.tags, state.preferences, 30);
    state.searchMatches = matches;
    if (!matches.length) {
      state.searchIndex = -1;
      if (rawQuery) {
        results.appendChild(element("div", "bpi-empty", state.largeSearchLoading ? "正在查询大型词库…" : "没有找到匹配标签，可添加到个人词库。"));
        results.classList.add("bpi-visible");
      } else {
        results.classList.remove("bpi-visible");
      }
      return;
    }
    if (state.searchIndex < 0 || state.searchIndex >= matches.length) state.searchIndex = 0;
    for (const [index, tag] of matches.entries()) {
      const result = element("div", "bpi-result");
      if (index === state.searchIndex) result.classList.add("bpi-result-selected");
      const meta = element("span", "bpi-category");
      meta.appendChild(element("span", "", `${tag.category} · ${tag.pack_name ?? sourceLabel(tag.source)}`));
      const star = element("span", `bpi-result-star${isFavorite(tag.english) ? " bpi-starred" : ""}`, isFavorite(tag.english) ? "★" : "☆");
      star.title = isFavorite(tag.english) ? "取消收藏" : "收藏标签";
      star.addEventListener("click", (event) => {
        event.stopPropagation();
        changeFavorite(tag.english);
        renderSearch();
        render();
      });
      meta.appendChild(star);
      result.append(element("span", "bpi-result-en", tag.english), element("span", "bpi-result-zh", tag.chinese), meta);
      result.title = `点击插入英文标签${tag.aliases?.length ? `｜别名：${tag.aliases.join("、")}` : ""}`;
      result.addEventListener("mouseenter", () => { state.searchIndex = index; });
      result.addEventListener("click", (event) => {
        event.stopPropagation();
        insertEnglish(tag.english);
      });
      results.appendChild(result);
    }
    if (state.largeSearchLoading) results.appendChild(element("div", "bpi-searching", "正在补充查询大型词库…"));
    results.classList.add("bpi-visible");
  };

  const translateAllUnknown = async (control) => {
    const seen = new Set();
    const unknown = state.tokens.filter((token) => {
      if (token.status !== "unknown" || /[\u3400-\u9fff]/.test(token.term) || seen.has(token.key)) return false;
      seen.add(token.key);
      return true;
    }).slice(0, 30);
    if (!unknown.length) {
      setStatus("当前没有未知标签", "ok");
      return;
    }
    control.disabled = true;
    let completed = 0;
    try {
      for (let index = 0; index < unknown.length; index += 1) {
        setStatus(`翻译未知标签 ${index + 1}/${unknown.length}：${unknown[index].term}`, "busy");
        if (await translateToken(unknown[index])) completed += 1;
      }
      const rejected = unknown.length - completed;
      setStatus(`翻译完成 ${completed} 项${rejected ? `，拒绝异常结果 ${rejected} 项` : ""}`, rejected ? "error" : "ok");
    } finally {
      control.disabled = false;
    }
  };

  const exportUserDictionary = async () => {
    try {
      const response = await bpiFetch(`${API_ROOT}/export`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "导出失败");
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = element("a");
      link.href = url;
      link.download = `bpi-user-tags-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setStatus(`已导出 ${payload.tags?.length ?? 0} 个个人标签`, "ok");
    } catch (error) {
      setStatus(error.message, "error");
    }
  };

  const openImportPreview = (payload) => {
    if (!payload || !Array.isArray(payload.tags)) throw new Error("文件中没有 tags 数组");
    const report = previewImport(payload.tags, state.data.tags);
    const shade = element("div", "bpi-modal-shade");
    const modal = element("div", "bpi-modal");
    modal.appendChild(element("h3", "", "导入个人词库预览"));
    const stats = element("div", "bpi-import-stat");
    stats.append(
      element("span", "", `总计 ${report.total}`),
      element("span", "", `新增 ${report.added}`),
      element("span", "", `冲突 ${report.conflicts.length}`),
      element("span", "", `重复 ${report.duplicates}`),
      element("span", report.invalid ? "bpi-danger-text" : "", `无效 ${report.invalid}`),
    );
    modal.appendChild(stats);
    const explanation = element("p", "", "导入前会自动备份当前个人词库。你可以保留当前解释、使用导入解释，或把不同的导入中文合并为别名。内置词库文件始终不会被修改。");
    modal.appendChild(explanation);
    if (report.conflicts.length) {
      const conflicts = element("div", "bpi-import-conflicts");
      const header = element("div", "bpi-import-conflict");
      header.append(element("strong", "", "英文"), element("strong", "", "当前有效解释"), element("strong", "", "导入解释"));
      conflicts.appendChild(header);
      for (const conflict of report.conflicts.slice(0, 100)) {
        const row = element("div", "bpi-import-conflict");
        row.append(element("span", "", conflict.english), element("span", "", conflict.current), element("span", "", conflict.incoming));
        conflicts.appendChild(row);
      }
      modal.appendChild(conflicts);
    }
    const modeLine = element("div", "bpi-manager-head");
    const modeLabel = element("label", "", "同名冲突：");
    const mode = element("select", "bpi-mode");
    for (const [value, label] of [["skip", "保留当前解释"], ["overwrite", "使用导入解释"], ["alias", "导入为中文别名"]]) {
      const option = element("option", "", label);
      option.value = value;
      mode.appendChild(option);
    }
    modeLine.append(modeLabel, mode);
    modal.appendChild(modeLine);
    const error = element("div", "bpi-status");
    error.dataset.kind = "error";
    modal.appendChild(error);
    const actions = element("div", "bpi-modal-actions");
    const close = () => shade.remove();
    const confirm = button("确认导入", async () => {
      if (report.invalid) return;
      confirm.disabled = true;
      try {
        let importValues = payload.tags;
        let importMode = mode.value;
        if (mode.value === "alias") {
          importValues = mergeImportAsAliases(payload.tags, state.data.tags);
          importMode = "overwrite";
        }
        const imported = await importTags(importValues, importMode);
        close();
        await refreshDictionary();
        setStatus(`导入完成：新增 ${imported.added}，覆盖 ${imported.replaced}，跳过 ${imported.skipped}｜已自动备份`, "ok");
      } catch (importError) {
        error.textContent = importError.message;
        confirm.disabled = false;
      }
    }, "bpi-primary");
    if (report.invalid) {
      confirm.disabled = true;
      error.textContent = "导入文件包含缺少英文或中文的无效词条，请先修正文件。";
    }
    actions.append(button("取消", close), confirm);
    modal.appendChild(actions);
    shade.appendChild(modal);
    document.body.appendChild(shade);
    shade.addEventListener("mousedown", (event) => { if (event.target === shade) close(); });
    modal.addEventListener("mousedown", (event) => event.stopPropagation());
  };

  const openDictionaryManager = () => {
    const shade = element("div", "bpi-modal-shade");
    const modal = element("div", "bpi-modal bpi-manager");
    const managerHead = element("div", "bpi-manager-head");
    managerHead.appendChild(element("h3", "", "词库管理"));
    const managerSearch = element("input", "bpi-search bpi-manager-search");
    managerSearch.placeholder = "搜索英文、中文、别名或分类";
    const sourceFilter = element("select", "bpi-mode");
    const categoryFilter = element("select", "bpi-mode");
    managerHead.append(managerSearch, sourceFilter, categoryFilter);
    const packSection = element("div", "bpi-pack-section");
    const packToolbar = element("div", "bpi-pack-toolbar");
    packToolbar.appendChild(element("strong", "", "独立词库包"));
    const packToolbarActions = element("div", "bpi-toolbar-group");
    const communityInput = element("input");
    communityInput.type = "file";
    communityInput.accept = ".json,application/json";
    communityInput.style.display = "none";
    packToolbar.appendChild(packToolbarActions);
    const packList = element("div", "bpi-pack-list");
    packSection.append(packToolbar, packList, communityInput);
    const managerSummary = element("div", "bpi-manager-summary");
    const managerTable = element("div", "bpi-manager-table");
    const managerStatus = element("span", "bpi-status");
    const footer = element("div", "bpi-manager-footer");
    const footerLeft = element("div", "bpi-toolbar-group");
    const footerRight = element("div", "bpi-toolbar-group");
    const selected = new Set();
    let visibleRows = [];
    let managerLargeMatches = [];
    let managerLargeQuery = "";
    let managerLargeLoading = false;
    let managerLargeTimer = null;
    let managerLargeGeneration = 0;
    let managerRefreshCallback = null;

    const close = () => {
      clearTimeout(managerLargeTimer);
      managerLargeGeneration += 1;
      if (state.managerRefresh === managerRefreshCallback) state.managerRefresh = null;
      shade.remove();
    };
    const machineRows = () => [...state.machine.entries()].map(([key, item]) => ({
      key,
      kind: "machine",
      tag: {
        english: item.english ?? key,
        chinese: item.text,
        aliases: [],
        category: "待确认",
        models: ["general", "anima"],
        source: "bpi-assistant",
        verified: false,
      },
    })).filter((row) => !state.index.has(row.key));

    const managerRows = () => {
      const personalKeys = new Set(state.data.user.map((tag) => normalizeKey(tag.english)));
      const localKeys = new Set(state.data.tags.map((tag) => normalizeKey(tag.english)));
      return [
        ...state.data.tags.map((tag) => ({ key: normalizeKey(tag.english), kind: personalKeys.has(normalizeKey(tag.english)) ? "personal" : "builtin", tag })),
        ...managerLargeMatches
          .filter((tag) => !localKeys.has(normalizeKey(tag.english)))
          .map((tag) => ({ key: normalizeKey(tag.english), kind: "large", tag })),
        ...machineRows(),
      ];
    };

    const rebuildSourceFilters = () => {
      const current = sourceFilter.value;
      sourceFilter.replaceChildren();
      const options = [
        ["all", "全部词库"],
        ["builtin", "所有已启用内置包"],
        ["personal", "个人词库"],
        ...(state.data.large_dictionary?.available ? [["large", `${state.data.large_dictionary.enabled ? "✓" : "○"} Danbooru 大型词库`]] : []),
        ["machine", "待确认机器译"],
        ["favorites", "收藏"],
        ["recent", "最近插入"],
        ...(state.data.packs ?? []).map((pack) => [`pack:${pack.id}`, `${pack.enabled ? "✓" : "○"} ${pack.name}`]),
      ];
      for (const [value, label] of options) {
        const option = element("option", "", label);
        option.value = value;
        sourceFilter.appendChild(option);
      }
      sourceFilter.value = options.some(([value]) => value === current) ? current : "all";
    };

    const rebuildCategories = () => {
      const current = categoryFilter.value;
      categoryFilter.replaceChildren();
      const all = element("option", "", "全部分类");
      all.value = "all";
      categoryFilter.appendChild(all);
      const categories = [...new Set(managerRows().map((row) => row.tag.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
      for (const category of categories) {
        const option = element("option", "", category);
        option.value = category;
        categoryFilter.appendChild(option);
      }
      categoryFilter.value = [...categoryFilter.options].some((option) => option.value === current) ? current : "all";
    };

    const renderManager = () => {
      rebuildSourceFilters();
      rebuildCategories();
      const query = managerSearch.value.trim().toLowerCase();
      const category = categoryFilter.value;
      visibleRows = managerRows().filter((row) => {
        if (sourceFilter.value === "favorites" && !isFavorite(row.tag.english)) return false;
        if (sourceFilter.value === "recent" && !state.preferences.recent.includes(row.key)) return false;
        if (sourceFilter.value.startsWith("pack:") && row.tag.pack_id !== sourceFilter.value.slice(5)) return false;
        if (!["all", "favorites", "recent"].includes(sourceFilter.value) && !sourceFilter.value.startsWith("pack:") && row.kind !== sourceFilter.value) return false;
        if (category !== "all" && row.tag.category !== category) return false;
        if (query) {
          const haystack = [row.tag.english, row.tag.chinese, row.tag.category, ...(row.tag.aliases ?? [])].join("\n").toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        return true;
      });
      managerTable.replaceChildren();
      const header = element("div", "bpi-manager-row bpi-manager-header");
      const selectAll = element("input");
      selectAll.type = "checkbox";
      selectAll.checked = visibleRows.length > 0 && visibleRows.every((row) => selected.has(`${row.kind}:${row.key}`));
      selectAll.addEventListener("change", () => {
        for (const row of visibleRows) {
          const id = `${row.kind}:${row.key}`;
          if (selectAll.checked) selected.add(id); else selected.delete(id);
        }
        renderManager();
      });
      const selectCell = element("div");
      selectCell.appendChild(selectAll);
      header.append(selectCell, element("div", "", "英文"), element("div", "", "主要中文"), element("div", "", "分类"), element("div", "", "来源"), element("div", "", "操作"));
      managerTable.appendChild(header);
      for (const rowData of visibleRows) {
        const { tag, key, kind } = rowData;
        const id = `${kind}:${key}`;
        const row = element("div", `bpi-manager-row${selected.has(id) ? " bpi-manager-selected" : ""}`);
        const checkbox = element("input");
        checkbox.type = "checkbox";
        checkbox.checked = selected.has(id);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selected.add(id); else selected.delete(id);
          renderManager();
        });
        const checkCell = element("div");
        checkCell.appendChild(checkbox);
        const en = element("div", "bpi-en bpi-manager-insertable", tag.english);
        const zh = element("div", "bpi-zh bpi-manager-insertable", tag.chinese);
        const insertFromManager = () => {
          insertEnglish(tag.english, true);
          managerStatus.textContent = `已插入 ${tag.english}`;
          managerStatus.dataset.kind = "ok";
        };
        en.title = `${tag.aliases?.length ? `别名：${tag.aliases.join("、")}｜` : ""}双击插入英文标签`;
        zh.title = "双击插入对应英文标签";
        en.addEventListener("dblclick", insertFromManager);
        zh.addEventListener("dblclick", insertFromManager);
        const actions = element("div", "bpi-manager-actions");
        const insert = button("插入", insertFromManager, "bpi-mini bpi-primary");
        insert.title = "将英文标签插入上方实际输出文本框";
        actions.appendChild(insert);
        const star = button(isFavorite(tag.english) ? "★" : "☆", () => {
          changeFavorite(tag.english);
          renderManager();
          renderSearch();
          render();
        }, `bpi-mini bpi-star${isFavorite(tag.english) ? " bpi-starred" : ""}`);
        star.title = isFavorite(tag.english) ? "取消收藏" : "收藏";
        actions.appendChild(star);
        if (kind === "machine") {
          actions.append(
            button("确认", async () => {
              try {
                await importTags([{ ...tag, verified: true }], "overwrite");
                deleteMachineTranslation(key);
                await refreshDictionary();
                renderManager();
                managerStatus.textContent = `已确认 ${tag.english}`;
                managerStatus.dataset.kind = "ok";
              } catch (error) { managerStatus.textContent = error.message; managerStatus.dataset.kind = "error"; }
            }, "bpi-mini"),
            button("重译", async () => {
              deleteMachineTranslation(key);
              await translateToken({ key, term: tag.english, status: "unknown" });
              renderManager();
            }, "bpi-mini"),
          );
        } else {
          actions.appendChild(button(kind === "large" ? "保存个人" : "编辑", () => openTagDialog(tag, async () => {
            await refreshDictionary();
            renderManager();
          }), "bpi-mini"));
          if (kind === "personal") {
            const hasBuiltin = Boolean(builtinTagFor(tag.english));
            actions.appendChild(button(hasBuiltin ? "恢复内置" : "删除", async () => {
              if (!window.confirm(`${hasBuiltin ? "删除个人覆盖并恢复内置解释" : "删除个人标签"}“${tag.english}”？`)) return;
              try {
                await deletePersonalTag(tag.english);
                selected.delete(id);
                await refreshDictionary();
                renderManager();
              } catch (error) { managerStatus.textContent = error.message; managerStatus.dataset.kind = "error"; }
            }, "bpi-mini"));
          }
        }
        actions.append(button("复制", () => copyText(tag.english, `已复制 ${tag.english}`), "bpi-mini"));
        const sourceName = kind === "machine" ? "机器译" : kind === "personal" ? "个人词库" : (tag.pack_name ?? "内置词库");
        row.append(checkCell, en, zh, element("div", "", tag.category), element("div", "", sourceName), actions);
        managerTable.appendChild(row);
      }
      if (managerLargeLoading) managerTable.appendChild(element("div", "bpi-searching", "正在按需查询 Danbooru 大型词库…"));
      if (!visibleRows.length && !managerLargeLoading) {
        const emptyText = sourceFilter.value === "large" && !query
          ? "大型词库不会整库加载，请在上方输入英文或中文关键词。"
          : "当前筛选条件下没有词条。";
        managerTable.appendChild(element("div", "bpi-empty", emptyText));
      }
      const enabledPacks = (state.data.packs ?? []).filter((pack) => pack.enabled).length;
      const large = state.data.large_dictionary;
      const largeSummary = large?.available ? `｜大型库 ${large.count}（${large.enabled ? "按需启用" : "已停用"}）` : "｜大型库未安装";
      managerSummary.textContent = `显示 ${visibleRows.length} 项｜已选 ${selected.size} 项｜已启用包 ${enabledPacks}/${state.data.packs?.length ?? 0}｜内置有效 ${state.data.builtin.length}${largeSummary}｜个人 ${state.data.user.length}｜待确认 ${machineRows().length}｜收藏 ${state.preferences.favorites.length}｜最近 ${state.preferences.recent.length}`;
    };

    const openCommunityPackPreview = (payload, filename) => {
      if (!payload || !Array.isArray(payload.tags)) {
        managerStatus.textContent = "社区词库文件必须包含 tags 数组";
        managerStatus.dataset.kind = "error";
        return;
      }
      const nestedShade = element("div", "bpi-modal-shade");
      const nested = element("div", "bpi-modal");
      nested.appendChild(element("h3", "", "导入为独立社区词库包"));
      const form = element("div", "bpi-community-form");
      const metadata = payload.pack && typeof payload.pack === "object" ? payload.pack : {};
      const fallbackName = String(filename ?? "community-pack.json").replace(/\.json$/i, "");
      const fields = {};
      for (const [key, label, value, placeholder] of [
        ["name", "词库包名称", metadata.name ?? fallbackName, "例如：社区姿势扩展"],
        ["id", "包ID（可选）", metadata.id ?? "", "英文、数字、横线"],
        ["version", "版本", metadata.version ?? "1.0.0", "例如：1.0.0"],
        ["source", "来源", metadata.source ?? "社区导入", "社区或作者名称"],
        ["license", "许可（可选）", metadata.license ?? "", "例如：CC BY 4.0"],
        ["homepage", "主页（可选）", metadata.homepage ?? "", "仅记录来源，不自动访问"],
      ]) {
        form.appendChild(element("label", "", label));
        const input = element("input");
        input.value = value;
        input.placeholder = placeholder;
        fields[key] = input;
        form.appendChild(input);
      }
      nested.appendChild(form);
      const preview = element("div", "bpi-community-preview");
      preview.textContent = `词条 ${payload.tags.length} 项｜示例：${payload.tags.slice(0, 8).map((tag) => `${tag?.english ?? "?"} → ${tag?.chinese ?? "?"}`).join("；")}`;
      nested.appendChild(preview);
      const overwriteLine = element("label", "bpi-manager-head");
      const overwrite = element("input");
      overwrite.type = "checkbox";
      overwriteLine.append(overwrite, element("span", "", "同ID社区包已存在时覆盖更新（更新前自动备份）"));
      nested.appendChild(overwriteLine);
      const error = element("div", "bpi-status");
      error.dataset.kind = "error";
      nested.appendChild(error);
      const actions = element("div", "bpi-modal-actions");
      const closeNested = () => nestedShade.remove();
      const confirm = button("导入社区包", async () => {
        if (!fields.name.value.trim()) { error.textContent = "词库包名称不能为空"; return; }
        confirm.disabled = true;
        try {
          const result = await importCommunityPack({
            ...payload,
            pack: {
              ...metadata,
              name: fields.name.value.trim(),
              id: fields.id.value.trim(),
              version: fields.version.value.trim(),
              source: fields.source.value.trim(),
              license: fields.license.value.trim(),
              homepage: fields.homepage.value.trim(),
            },
          }, overwrite.checked);
          closeNested();
          await refreshDictionary();
          renderPacks();
          renderManager();
          managerStatus.textContent = `${result.replaced ? "已更新" : "已导入"}社区包“${result.name}”，共 ${result.count} 项`;
          managerStatus.dataset.kind = "ok";
        } catch (importError) {
          error.textContent = importError.message;
          confirm.disabled = false;
        }
      }, "bpi-primary");
      actions.append(button("取消", closeNested), confirm);
      nested.appendChild(actions);
      nestedShade.appendChild(nested);
      document.body.appendChild(nestedShade);
      nestedShade.addEventListener("mousedown", (event) => { if (event.target === nestedShade) closeNested(); });
      nested.addEventListener("mousedown", (event) => event.stopPropagation());
      setTimeout(() => fields.name.focus(), 0);
    };

    const renderPacks = () => {
      packList.replaceChildren();
      const personalCard = element("div", "bpi-pack-card bpi-pack-personal");
      const personalMarker = element("span", "bpi-badge bpi-confidence-high", "最高");
      const personalBody = element("div");
      personalBody.append(element("div", "bpi-pack-name", "个人词库"), element("div", "bpi-pack-meta", `${state.data.user.length} 项｜本机用户｜始终启用并覆盖所有同名词条`));
      personalCard.append(personalMarker, personalBody, element("div", "bpi-pack-controls", "不可停用"));
      packList.appendChild(personalCard);
      const large = state.data.large_dictionary;
      if (large) {
        const card = element("div", `bpi-pack-card${large.enabled && large.available ? "" : " bpi-pack-disabled"}`);
        const toggle = element("input", "bpi-switch");
        toggle.type = "checkbox";
        toggle.checked = Boolean(large.enabled);
        toggle.disabled = !large.available;
        toggle.title = large.available ? "启用或停用大型词库按需查询" : "尚未安装大型词库数据库";
        toggle.addEventListener("change", async () => {
          toggle.disabled = true;
          try {
            await setLargeDictionaryEnabled(toggle.checked);
            await refreshDictionary();
            managerLargeMatches = [];
            managerLargeQuery = "";
            renderPacks();
            renderManager();
            managerStatus.textContent = `${toggle.checked ? "已启用" : "已停用"} Danbooru 大型词库`;
            managerStatus.dataset.kind = "ok";
          } catch (error) {
            managerStatus.textContent = error.message;
            managerStatus.dataset.kind = "error";
            toggle.checked = !toggle.checked;
            toggle.disabled = false;
          }
        });
        const body = element("div");
        body.append(
          element("div", "bpi-pack-name", large.name),
          element("div", "bpi-pack-meta", large.available
            ? `${large.count} 项｜版本 ${large.version}｜${large.source}｜只读、按需查询`
            : "尚未安装数据库｜不会影响现有小型词库"),
        );
        const controls = element("div", "bpi-pack-controls", large.available ? "只读" : "不可用");
        card.append(toggle, body, controls);
        packList.appendChild(card);
      }
      for (const pack of state.data.packs ?? []) {
        const card = element("div", `bpi-pack-card${pack.enabled ? "" : " bpi-pack-disabled"}`);
        const toggle = element("input", "bpi-switch");
        toggle.type = "checkbox";
        toggle.checked = Boolean(pack.enabled);
        toggle.title = pack.enabled ? "点击停用此词库包" : "点击启用此词库包";
        toggle.addEventListener("change", async () => {
          toggle.disabled = true;
          try {
            await setPackEnabled(pack.id, toggle.checked);
            await refreshDictionary();
            selected.clear();
            renderPacks();
            renderManager();
            managerStatus.textContent = `${toggle.checked ? "已启用" : "已停用"}“${pack.name}”`;
            managerStatus.dataset.kind = "ok";
          } catch (error) {
            managerStatus.textContent = error.message;
            managerStatus.dataset.kind = "error";
            toggle.checked = !toggle.checked;
            toggle.disabled = false;
          }
        });
        const body = element("div");
        body.append(
          element("div", "bpi-pack-name", pack.name),
          element("div", "bpi-pack-meta", `${pack.count} 项｜版本 ${pack.version}｜${pack.source}${pack.license ? `｜许可 ${pack.license}` : ""}`),
        );
        const controls = element("div", "bpi-pack-controls");
        controls.appendChild(button("导出", async () => {
          try {
            await exportDictionaryPack(pack.id, pack.name);
            managerStatus.textContent = `已导出“${pack.name}”`;
            managerStatus.dataset.kind = "ok";
          } catch (error) { managerStatus.textContent = error.message; managerStatus.dataset.kind = "error"; }
        }, "bpi-mini"));
        if (!pack.readonly) {
          controls.appendChild(button("删除", async () => {
            if (!window.confirm(`删除社区词库包“${pack.name}”？文件会先备份，可从 data/backups 恢复。`)) return;
            try {
              await deleteCommunityPack(pack.id);
              await refreshDictionary();
              selected.clear();
              renderPacks();
              renderManager();
              managerStatus.textContent = `已删除并备份“${pack.name}”`;
              managerStatus.dataset.kind = "ok";
            } catch (error) { managerStatus.textContent = error.message; managerStatus.dataset.kind = "error"; }
          }, "bpi-mini bpi-danger"));
        }
        card.append(toggle, body, controls);
        packList.appendChild(card);
      }
    };

    communityInput.addEventListener("change", async () => {
      const file = communityInput.files?.[0];
      communityInput.value = "";
      if (!file) return;
      try {
        openCommunityPackPreview(JSON.parse(await file.text()), file.name);
      } catch (error) {
        managerStatus.textContent = `社区包文件读取失败：${error.message}`;
        managerStatus.dataset.kind = "error";
      }
    });
    packToolbarActions.append(
      button("导入社区词库包", () => communityInput.click(), "bpi-primary"),
      button("刷新", async () => { await refreshDictionary(); renderPacks(); renderManager(); }),
    );

    const selectedRows = (kind) => managerRows().filter((row) => row.kind === kind && selected.has(`${row.kind}:${row.key}`));
    footerLeft.append(
      button("新增标签", () => openTagDialog({}, async () => { await refreshDictionary(); renderManager(); }), "bpi-primary"),
      button("确认所选机器译", async () => {
        const rows = selectedRows("machine");
        if (!rows.length) { managerStatus.textContent = "请先勾选待确认机器译"; managerStatus.dataset.kind = "error"; return; }
        try {
          const imported = await importTags(rows.map((row) => ({ ...row.tag, verified: true })), "overwrite");
          for (const row of rows) { deleteMachineTranslation(row.key); selected.delete(`machine:${row.key}`); }
          await refreshDictionary();
          renderManager();
          managerStatus.textContent = `已确认 ${imported.added + imported.replaced} 项，并自动备份个人词库`;
          managerStatus.dataset.kind = "ok";
        } catch (error) { managerStatus.textContent = error.message; managerStatus.dataset.kind = "error"; }
      }),
      button("批量分类/模型", async () => {
        const rows = selectedRows("personal");
        if (!rows.length) { managerStatus.textContent = "批量修改仅适用于已勾选的个人词条"; managerStatus.dataset.kind = "error"; return; }
        const category = window.prompt("新的分类（留空表示不修改分类）：", rows[0].tag.category ?? "");
        if (category === null) return;
        const models = window.prompt("适用模型，用逗号分隔（留空表示不修改模型）：", (rows[0].tag.models ?? []).join(", "));
        if (models === null) return;
        const updates = {};
        if (category.trim()) updates.category = category.trim();
        if (models.trim()) updates.models = models;
        if (!Object.keys(updates).length) return;
        try {
          const result = await bulkUpdateTags(rows.map((row) => row.tag.english), updates);
          await refreshDictionary();
          renderManager();
          managerStatus.textContent = `已批量修改 ${result.updated} 项，并自动备份个人词库`;
          managerStatus.dataset.kind = "ok";
        } catch (error) { managerStatus.textContent = error.message; managerStatus.dataset.kind = "error"; }
      }),
    );
    footerRight.append(managerStatus, button("关闭", close));
    footer.append(footerLeft, footerRight);
    modal.append(managerHead, packSection, managerSummary, managerTable, footer);
    managerRefreshCallback = (kind) => {
      if (!modal.isConnected) return;
      if (kind === "dictionary") renderPacks();
      renderManager();
    };
    state.managerRefresh = managerRefreshCallback;
    shade.appendChild(modal);
    document.body.appendChild(shade);
    managerSearch.addEventListener("input", () => {
      renderManager();
      const query = managerSearch.value.trim();
      clearTimeout(managerLargeTimer);
      if (!query || !largeDictionaryReady()) {
        managerLargeGeneration += 1;
        managerLargeQuery = "";
        managerLargeMatches = [];
        managerLargeLoading = false;
        renderManager();
        return;
      }
      if (query === managerLargeQuery) return;
      managerLargeQuery = query;
      managerLargeMatches = [];
      managerLargeLoading = true;
      const generation = ++managerLargeGeneration;
      managerLargeTimer = setTimeout(async () => {
        try {
          const found = await searchLargeDictionary(query, 100);
          if (generation !== managerLargeGeneration || managerSearch.value.trim() !== query) return;
          managerLargeMatches = found;
          for (const tag of found) state.largeCache.set(normalizeKey(tag.english), tag);
          rebuildDictionaryIndex();
        } catch (error) {
          if (generation === managerLargeGeneration) {
            managerStatus.textContent = error.message;
            managerStatus.dataset.kind = "error";
          }
        } finally {
          if (generation === managerLargeGeneration) {
            managerLargeLoading = false;
            renderManager();
          }
        }
      }, 260);
    });
    sourceFilter.addEventListener("change", renderManager);
    categoryFilter.addEventListener("change", renderManager);
    shade.addEventListener("mousedown", (event) => { if (event.target === shade) close(); });
    modal.addEventListener("mousedown", (event) => event.stopPropagation());
    renderPacks();
    renderManager();
    setTimeout(() => managerSearch.focus(), 0);
  };

  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    importInput.value = "";
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      openImportPreview(payload);
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  const translateAllButton = button("翻译全部未知", () => translateAllUnknown(translateAllButton));
  detailsToggle = button("", () => setDetailsExpanded(state.preferences.detailsExpanded === false));
  detailsHead.append(detailsToggle, element("strong", "", "标签翻译与词库管理"), detailsSummary);
  for (const [filter, label] of [["all", "全部"], ["unknown", "未知"], ["machine", "机器译"], ["personal", "个人词库"], ["favorites", "收藏"]]) {
    const control = button(label, () => {
      state.tableFilter = filter;
      render();
    });
    state.filterButtons.set(filter, control);
    filtersBar.appendChild(control);
  }
  leftTools.append(
    button("添加标签", () => openTagDialog({}, refreshDictionary), "bpi-primary"),
    translateAllButton,
    button("清除临时机器译", () => {
      clearMachineTranslations();
      state.translating.clear();
      setStatus("已清除尚未保存的机器译文", "ok");
      render();
    }),
  );
  rightTools.append(
    button("词库管理", openDictionaryManager, "bpi-primary"),
    button("导入", () => importInput.click()),
    button("导出", exportUserDictionary),
    button("刷新词库", refreshDictionary),
  );
  toolbar.append(leftTools, rightTools);
  searchLine.append(modeSelect, search);
  summary.append(counts, modeInfo, status);
  detailsBody.append(toolbar, searchLine, results, summary, filtersBar, issuesPanel, table);
  panel.append(englishSection, mirrorSection, detailsHead, detailsBody, aboutFooter, importInput);
  applyDetailsVisibility(false);
  panel.addEventListener("mousedown", (event) => event.stopPropagation());
  panel.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
  const handleTokenViewKeydown = (event) => {
    handleHistoryShortcut(event);
    if (event.defaultPrevented || !["Backspace", "Delete"].includes(event.key)) return;
    const token = state.tokens.find((item) => item.id === state.pinned);
    if (!token) return;
    event.preventDefault();
    event.stopPropagation();
    deleteTokenOccurrence(token);
  };
  englishTokenView.addEventListener("keydown", handleTokenViewKeydown);
  chineseMirror.addEventListener("keydown", (event) => {
    handleHistoryShortcut(event);
    if (event.defaultPrevented || !["Backspace", "Delete"].includes(event.key)) return;
    const token = state.tokens.find((item) => item.id === state.pinned);
    if (!token) return;
    event.preventDefault();
    event.stopPropagation();
    deleteTokenOccurrence(token);
  });
  chineseMirror.title = "点击标签可与上方英文和下方明细联动";
  englishTokenView.title = "点击英文标签可与中文和下方明细联动";
  englishEditor.title = "输入期间保持文本编辑；失去焦点或点击完成编辑后切换为标签视图";
  chineseEditor.title = "输入中文、英文或中英混合内容；高度会随内容自动调整";
  englishTokenView.addEventListener("click", (event) => {
    if (event.target !== englishTokenView) return;
    state.pinned = null;
    render();
  });
  chineseMirror.addEventListener("click", (event) => {
    if (event.target !== chineseMirror) return;
    state.pinned = null;
    render();
  });
  const bindMirrorAction = (control, action) => control.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  });
  editChineseButton.title = "在标签联动视图与中英文文本编辑框之间切换";
  translateChineseButton.title = "自动检测语言并忠实翻译；不优化、不自动同步";
  translateOptimizeButton.title = "自动翻译后优化成符合 Anima 格式的英文提示词";
  optimizeChineseButton.title = "只优化已有英文，不承担翻译";
  sortPromptButton.title = "所有内容完成后，手动按 Anima 九段顺序整理";
  assistantSettingsButton.title = "配置纯词库、Ollama 或 OpenAI 兼容 API 与自定义规则";
  bindMirrorAction(editChineseButton, () => setChineseEditing(!state.chineseEditing));
  bindMirrorAction(translateChineseButton, () => runTextAssistant("translate"));
  bindMirrorAction(translateOptimizeButton, () => runTextAssistant("translate_optimize"));
  bindMirrorAction(optimizeChineseButton, () => runTextAssistant("optimize"));
  bindMirrorAction(syncTextButton, syncEditedText);
  bindMirrorAction(sortPromptButton, sortByAnimaOrder);
  bindMirrorAction(assistantSettingsButton, () => openAssistantSettings(null, setStatus));
  editEnglishButton.title = "在英文文本编辑框和可联动标签视图之间切换";
  editEnglishButton.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  editEnglishButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setEnglishEditing(!state.englishEditing);
  });
  englishEditor.addEventListener("mousedown", (event) => {
    event.stopPropagation();
    startManualResize("english", englishEditor, event);
  });
  englishEditor.addEventListener("input", () => {
    state.englishEditorDirty = true;
    updateText(englishEditor.value);
  });
  englishEditor.addEventListener("keydown", (event) => {
    handleHistoryShortcut(event);
    if (event.defaultPrevented) return;
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      setEnglishEditing(false);
    }
  });
  englishEditor.addEventListener("blur", () => {
    setTimeout(() => {
      if (state.englishEditing && document.activeElement !== englishEditor) setEnglishEditing(false);
    }, 0);
  });
  chineseEditor.addEventListener("mousedown", (event) => event.stopPropagation());
  chineseEditor.addEventListener("input", () => {
    state.stagedText = {
      text: chineseEditor.value,
      label: "手动编辑",
      requireAnima: state.stagedText?.requireAnima === true,
    };
    mirrorTitle.textContent = "文本编辑与处理（支持中英混合）";
    mirrorHint.textContent = containsChinese(chineseEditor.value)
      ? "检测到中文或混合内容，可使用“仅翻译”或“翻译并优化”"
      : "英文内容可直接同步，或继续优化为 Anima";
    autoFitGreenArea(chineseEditor, 110);
    updateStageControls();
  });
  chineseEditor.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      runTextAssistant("translate");
    }
  });
  search.addEventListener("input", renderSearch);
  search.addEventListener("focus", renderSearch);
  modeSelect.addEventListener("change", () => {
    state.modePreference = modeSelect.value;
    state.editing = null;
    render();
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && state.searchMatches.length) {
      event.preventDefault();
      state.searchIndex = (state.searchIndex + 1) % state.searchMatches.length;
      renderSearch();
      results.children[state.searchIndex]?.scrollIntoView?.({ block: "nearest" });
      return;
    }
    if (event.key === "ArrowUp" && state.searchMatches.length) {
      event.preventDefault();
      state.searchIndex = (state.searchIndex - 1 + state.searchMatches.length) % state.searchMatches.length;
      renderSearch();
      results.children[state.searchIndex]?.scrollIntoView?.({ block: "nearest" });
      return;
    }
    if (event.key === "Enter" && state.searchMatches[state.searchIndex]) {
      event.preventDefault();
      insertEnglish(state.searchMatches[state.searchIndex].english, event.ctrlKey);
      return;
    }
    if (event.key === "Escape") {
      search.value = "";
      state.searchMatches = [];
      state.searchIndex = -1;
      renderSearch();
    }
  });

  const originalCallback = textWidget.callback;
  textWidget.callback = function (value) {
    const result = originalCallback?.apply(this, arguments);
    const nextText = String(value ?? "");
    if (state.englishEditing) {
      if (document.activeElement !== englishEditor && !state.englishEditingExplicit && nextText.trim()) {
        state.englishEditing = false;
        state.englishEditorDirty = false;
        englishEditor.value = nextText;
      }
    } else if (!nextText.trim()) {
      state.englishEditing = true;
      state.englishEditingExplicit = false;
      state.englishEditorDirty = false;
      englishEditor.value = nextText;
    }
    if (!state.chineseEditing) {
      state.editorInitialized = false;
      state.stagedText = null;
      updateStageControls();
    }
    scheduleRender();
    return result;
  };

  const syncFromPeer = async (kind, source) => {
    if (source === state.syncSource) return;
    if (kind === "preferences") {
      const sharedPreferences = loadPreferences();
      state.preferences = {
        ...state.preferences,
        favorites: sharedPreferences.favorites,
        recent: sharedPreferences.recent,
      };
      render();
      renderSearch();
    } else if (kind === "machine") {
      render();
    } else if (kind === "dictionary") {
      await refreshDictionary(false);
    }
    state.managerRefresh?.(kind);
  };
  const unsubscribePanelSync = panelSyncHub.subscribe(syncFromPeer);

  updateStageControls();
  refreshDictionary(false);
  setTimeout(() => {
    bindTextareaEvents();
    render();
  }, 0);
  return {
    panel,
    getMinHeight() {
      return state.preferences.detailsExpanded === false ? state.collapsedWidgetHeight : EXPANDED_WIDGET_MIN_HEIGHT;
    },
    getMaxHeight() {
      return state.preferences.detailsExpanded === false ? state.collapsedWidgetHeight : EXPANDED_WIDGET_MAX_HEIGHT;
    },
    isDetailsExpanded() {
      return state.preferences.detailsExpanded !== false;
    },
    syncInitialLayout() {
      const expanded = state.preferences.detailsExpanded !== false;
      if (!expanded && hasNodeSize() && (node.size[1] ?? 0) > COLLAPSED_NODE_MIN_HEIGHT) {
        state.expandedNodeHeight = Math.max(node.size[1], EXPANDED_NODE_DEFAULT_HEIGHT);
        state.collapsedBaseHeight = null;
      }
      if (!expanded || (node.size?.[1] ?? 0) < EXPANDED_NODE_DEFAULT_HEIGHT) requestNodeResize(expanded);
    },
    checkForTextChange() {
      const current = String(textWidget.value ?? "");
      if (current !== state.lastText) scheduleRender();
      bindTextareaEvents();
    },
    destroy() {
      unsubscribePanelSync();
      state.managerRefresh = null;
      clearTimeout(state.renderTimer);
      clearTimeout(state.largeLookupTimer);
      clearTimeout(state.largeSearchTimer);
      if (state.resizeFrame !== null) cancelAnimationFrame(state.resizeFrame);
      if (state.boundTextarea && state.textareaListeners) {
        for (const [name, listener] of state.textareaListeners) state.boundTextarea.removeEventListener(name, listener);
        state.boundTextarea.classList.remove("bpi-english-resizable", "bpi-english-linked");
      }
      if (state.windowPointerUp) window.removeEventListener("pointerup", state.windowPointerUp, true);
    },
  };
}

injectStyles();
installBpiWheelGuard();

app.registerExtension({
  name: "ComfyUI.BilingualPromptInspector",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;

    const originalCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      originalCreated?.apply(this, arguments);
      const textWidget = this.widgets?.find((widget) => widget.name === "text");
      if (!textWidget) return;
      textWidget.label = "英文提示词（实际输出）";

      const inspector = createPanel(this, textWidget);
      this._bilingualPromptInspector = inspector;
      try {
        this.addDOMWidget("bilingual_inspector", "bilingual-inspector", inspector.panel, {
          getMinHeight: () => inspector.getMinHeight(),
          getMaxHeight: () => inspector.getMaxHeight(),
          hideOnZoom: false,
          serialize: false,
        });
      } catch (error) {
        console.error("[BilingualPromptInspector] 无法创建界面", error);
        inspector.destroy();
        return;
      }
      const width = Math.max(this.size?.[0] ?? 0, 590);
      const height = Math.max(this.size?.[1] ?? 0, inspector.isDetailsExpanded() ? EXPANDED_NODE_DEFAULT_HEIGHT : COLLAPSED_NODE_MIN_HEIGHT);
      this.setSize?.([width, height]);
      requestAnimationFrame(() => inspector.syncInitialLayout());
    };

    const originalDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function () {
      originalDrawForeground?.apply(this, arguments);
      this._bilingualPromptInspector?.checkForTextChange();
    };

    const originalRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this._bilingualPromptInspector?.destroy();
      originalRemoved?.apply(this, arguments);
    };
  },
});
