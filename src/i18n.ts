// Tiny in-house i18n — one file, zero deps, zustand-backed locale store +
// flat string dictionary. Only the high-traffic surface is translated
// (sidebar, settings rail / Canvas / About, prompt bar banner + placeholder)
// so each pane stays a single screen the user can compare side-by-side
// without missing strings sticking out as English.

import { create } from 'zustand';

export type Locale = 'en' | 'zh-CN' | 'ja';

export const LOCALES: { id: Locale; label: string; native: string }[] = [
  { id: 'en',    label: 'English',          native: 'English' },
  { id: 'zh-CN', label: 'Simplified Chinese', native: '简体中文' },
  { id: 'ja',    label: 'Japanese',         native: '日本語' },
];

const STORAGE_KEY = 'franklin-canvas:locale';

function loadLocale(): Locale {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'en' || v === 'zh-CN' || v === 'ja') return v;
    // Fall back to the browser's preferred language if it matches.
    const nav = navigator.language || '';
    if (nav.startsWith('zh')) return 'zh-CN';
    if (nav.startsWith('ja')) return 'ja';
    return 'en';
  } catch { return 'en'; }
}

interface LocaleState {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: loadLocale(),
  setLocale: (locale) => {
    try { localStorage.setItem(STORAGE_KEY, locale); } catch { /* quota ignored */ }
    set({ locale });
  },
}));

// Flat key dictionary. Keys read like `area_subject` so they group naturally
// in the source file. Strings can interpolate `{name}` placeholders.
type Strings = Record<string, string>;

const en: Strings = {
  // Sidebar
  sidebar_brand: 'Franklin Canvas',
  sidebar_canvas: 'Canvas',
  sidebar_comparison: 'Comparison',
  sidebar_projects: 'Projects',
  sidebar_library: 'Collections',
  sidebar_wallet: 'Wallet',
  sidebar_settings: 'Settings',
  sidebar_collapse: 'Collapse sidebar',
  sidebar_expand: 'Expand sidebar',
  // Settings dialog
  settings_title: 'Settings',
  settings_section_wallet: 'Wallet',
  settings_section_models: 'Models & pricing',
  settings_section_canvas: 'Canvas',
  settings_section_agent: 'Agent',
  settings_section_about: 'About',
  settings_close: 'Close settings',
  // Agent pane
  agent_mode: 'Run mode',
  agent_mode_manual: 'Manual confirm',
  agent_mode_manual_hint: 'The agent asks for your confirmation before each generation.',
  agent_mode_auto: 'Auto run',
  agent_mode_auto_hint: 'The agent plans and runs the whole workflow on its own.',
  agent_default_image: 'Default image model',
  agent_default_video: 'Default video model',
  agent_models_hint: 'The agent uses these models for the image / video steps it builds.',
  // Canvas pane
  canvas_theme: 'Theme',
  canvas_theme_dark: 'Dark',
  canvas_theme_gold: 'Gold',
  canvas_theme_light: 'Light',
  canvas_theme_dark_hint: 'Neutral zinc dark with the lime gradient accent.',
  canvas_theme_gold_hint: 'Warm cream + petrol-ink with a gold thread.',
  canvas_theme_light_hint: 'Cool minimal white with petrol accent.',
  canvas_edges: 'Connection lines',
  canvas_edges_animated: 'Animated',
  canvas_edges_solid: 'Solid',
  canvas_edges_subtle: 'Subtle',
  canvas_edges_animated_hint: 'A light pulse flows along each connection (lively).',
  canvas_edges_solid_hint: 'A static gradient — calm, still on-brand.',
  canvas_edges_subtle_hint: 'A thin neutral line — minimal, no gradient.',
  canvas_language: 'Language',
  canvas_language_hint: 'Sidebar, settings, and the prompt-bar banner switch right away. Generated content stays in whatever language you prompt for.',
  canvas_apply_hint: 'Theme, connection style, and language apply instantly across the canvas.',
  // PromptBar
  pb_placeholder: 'Describe anything you want to generate…',
  pb_editing: 'Editing',
  pb_wallet_ready: 'Wallet ready on {network}. Send USDC to',
  pb_wallet_new: 'Wallet just created on {network}. Send USDC to',
  pb_wallet_tail: 'to start generating.',
  pb_send: 'Send',
  // Seedance 2.0 reference mode toggle (first/last frame vs omni multi-reference)
  pb_ref_frames: 'First / Last',
  pb_ref_refs: 'References',
  pb_ref_frames_hint: 'First & last frame — animate between two images',
  pb_ref_refs_hint: 'Reference images — character / style / scene refs (Seedance 2.0)',
  pb_ref_add: 'Add reference',
  // About pane
  about_blurb: 'Franklin Canvas — a node-based AI media studio. Generate images, video and music on an infinite canvas, paid live in USDC via x402 through the BlockRun gateway.',
  about_version: 'Version',
  about_gateway: 'Gateway',
  about_credits: 'Credits',
  about_credits_blurb: 'The Prompt Library inside the canvas is sourced from the open BlockRunAI Prompt-Case-Hub on GitHub — a unified, format-standardized aggregation of open-source prompt repositories. Each card lazy-loads from the upstream repo; credit goes to the original prompt authors.',
  // Preview dialog
  preview_title: 'Preview',
  preview_close: 'Close preview',
  preview_prompt: 'Prompt',
  preview_info: 'Info',
  preview_model: 'Model',
  preview_quality: 'Quality',
  preview_ratio: 'Aspect ratio',
  preview_duration: 'Duration',
  preview_filesize: 'File size',
  preview_date: 'Date',
  preview_creator: 'Creator',
  preview_download: 'Download',
  // Canvas view bar — zoom menu
  vb_fit: 'Fit to screen',
  vb_zoom_to: 'Zoom to {pct}%',
};

const zhCN: Strings = {
  sidebar_brand: 'Franklin Canvas',
  sidebar_canvas: '画布',
  sidebar_comparison: '模型对比',
  sidebar_projects: '项目',
  sidebar_library: '收藏夹',
  sidebar_wallet: '钱包',
  sidebar_settings: '设置',
  sidebar_collapse: '收起边栏',
  sidebar_expand: '展开边栏',
  settings_title: '设置',
  settings_section_wallet: '钱包',
  settings_section_models: '模型与价格',
  settings_section_canvas: '画布',
  settings_section_agent: 'Agent',
  settings_section_about: '关于',
  settings_close: '关闭设置',
  agent_mode: '运行模式',
  agent_mode_manual: '手动确认',
  agent_mode_manual_hint: 'Agent 在执行生成前都会寻求您的确认。',
  agent_mode_auto: '自动生成',
  agent_mode_auto_hint: 'Agent 会自主规划生成任务并自动执行。',
  agent_default_image: '默认图片模型',
  agent_default_video: '默认视频模型',
  agent_models_hint: 'Agent 在搭建图片 / 视频步骤时会使用这些模型。',
  canvas_theme: '主题',
  canvas_theme_dark: '深色',
  canvas_theme_gold: '金色',
  canvas_theme_light: '浅色',
  canvas_theme_dark_hint: '中性深灰底,辅以青柠渐变点缀。',
  canvas_theme_gold_hint: '暖米色 + 油墨蓝,带一缕金色。',
  canvas_theme_light_hint: '清爽极简的白色,辅以油墨蓝。',
  canvas_edges: '连接线样式',
  canvas_edges_animated: '动画',
  canvas_edges_solid: '实色',
  canvas_edges_subtle: '极简',
  canvas_edges_animated_hint: '一道光沿连线流动,有生气。',
  canvas_edges_solid_hint: '静态渐变 —— 稳重,依然有品牌色。',
  canvas_edges_subtle_hint: '一条细灰线 —— 极简,无渐变。',
  canvas_language: '语言',
  canvas_language_hint: '边栏、设置和提示栏横幅立即切换。生成内容仍用你输入提示词所用的语言。',
  canvas_apply_hint: '主题、连线样式和语言立即应用到整个画布。',
  pb_placeholder: '描述你想生成的任何东西……',
  pb_editing: '正在编辑',
  pb_wallet_ready: '已在 {network} 准备好钱包。请向',
  pb_wallet_new: '已在 {network} 自动创建钱包。请向',
  pb_wallet_tail: '充入 USDC 以开始生成。',
  pb_send: '发送',
  pb_ref_frames: '首尾帧',
  pb_ref_refs: '参考图',
  pb_ref_frames_hint: '首帧 + 尾帧 —— 在两张图之间生成过渡',
  pb_ref_refs_hint: '参考图 —— 角色 / 风格 / 场景参考(Seedance 2.0)',
  pb_ref_add: '添加参考图',
  about_blurb: 'Franklin Canvas —— 节点式 AI 媒体工作室。在无限画布上生成图像、视频与音乐,每次调用通过 BlockRun 网关以 x402 即时结算 USDC。',
  about_version: '版本',
  about_gateway: '网关',
  about_credits: '致谢',
  about_credits_blurb: '画布中的提示词库源自 GitHub 上 BlockRunAI 公开的 Prompt-Case-Hub —— 一个对市面开源 prompt 仓库做资源整合并统一 case 格式的聚合仓库。每张卡片在被滚动到视图内时才向上游仓库懒加载;原作者享有版权。',
  preview_title: '预览',
  preview_close: '关闭预览',
  preview_prompt: '提示词',
  preview_info: '信息',
  preview_model: '模型',
  preview_quality: '质量',
  preview_ratio: '宽高比',
  preview_duration: '时长',
  preview_filesize: '文件大小',
  preview_date: '日期',
  preview_creator: '创建者',
  preview_download: '下载',
  vb_fit: '适合屏幕',
  vb_zoom_to: '缩放至 {pct}%',
};

const ja: Strings = {
  sidebar_brand: 'Franklin Canvas',
  sidebar_canvas: 'キャンバス',
  sidebar_comparison: 'モデル比較',
  sidebar_projects: 'プロジェクト',
  sidebar_library: 'コレクション',
  sidebar_wallet: 'ウォレット',
  sidebar_settings: '設定',
  sidebar_collapse: 'サイドバーを折りたたむ',
  sidebar_expand: 'サイドバーを展開',
  settings_title: '設定',
  settings_section_wallet: 'ウォレット',
  settings_section_models: 'モデルと料金',
  settings_section_canvas: 'キャンバス',
  settings_section_agent: 'エージェント',
  settings_section_about: 'バージョン情報',
  settings_close: '設定を閉じる',
  agent_mode: '実行モード',
  agent_mode_manual: '手動確認',
  agent_mode_manual_hint: '生成の前に毎回確認を求めます。',
  agent_mode_auto: '自動実行',
  agent_mode_auto_hint: 'エージェントが自動でワークフローを計画・実行します。',
  agent_default_image: 'デフォルト画像モデル',
  agent_default_video: 'デフォルト動画モデル',
  agent_models_hint: 'エージェントが構築する画像／動画ステップでこれらのモデルを使用します。',
  canvas_theme: 'テーマ',
  canvas_theme_dark: 'ダーク',
  canvas_theme_gold: 'ゴールド',
  canvas_theme_light: 'ライト',
  canvas_theme_dark_hint: 'ニュートラルな亜鉛色ダーク、ライムグラデのアクセント。',
  canvas_theme_gold_hint: '温かいクリーム + ペトロールインク、金の糸を一筋。',
  canvas_theme_light_hint: 'クールなミニマル白、ペトロールアクセント。',
  canvas_edges: '接続線',
  canvas_edges_animated: 'アニメーション',
  canvas_edges_solid: 'ソリッド',
  canvas_edges_subtle: 'サブトル',
  canvas_edges_animated_hint: '光のパルスが各接続線を流れる(活き活き)。',
  canvas_edges_solid_hint: '静的なグラデーション ― 落ち着いた、ブランドに沿った見た目。',
  canvas_edges_subtle_hint: '細いニュートラル線 ― ミニマル、グラデーションなし。',
  canvas_language: '言語',
  canvas_language_hint: 'サイドバー、設定、プロンプトバーのバナーがすぐに切り替わります。生成内容はプロンプトで使用した言語のままです。',
  canvas_apply_hint: 'テーマ、接続線スタイル、言語は即座にキャンバス全体に反映されます。',
  pb_placeholder: '生成したいものを記述してください…',
  pb_editing: '編集中',
  pb_wallet_ready: '{network} でウォレット準備完了。USDC を',
  pb_wallet_new: '{network} にウォレットを自動作成しました。USDC を',
  pb_wallet_tail: 'に送金して生成を始めましょう。',
  pb_send: '送信',
  pb_ref_frames: '最初 / 最後',
  pb_ref_refs: '参照画像',
  pb_ref_frames_hint: '最初と最後のフレーム —— 2枚の画像の間を生成',
  pb_ref_refs_hint: '参照画像 —— キャラ / スタイル / シーン参照(Seedance 2.0)',
  pb_ref_add: '参照を追加',
  about_blurb: 'Franklin Canvas — ノードベースの AI メディアスタジオ。無限キャンバス上で画像、ビデオ、音楽を生成し、BlockRun ゲートウェイ経由で x402 を使い USDC を毎回その場で支払います。',
  about_version: 'バージョン',
  about_gateway: 'ゲートウェイ',
  about_credits: 'クレジット',
  about_credits_blurb: 'キャンバス内のプロンプトライブラリは GitHub の公開 BlockRunAI Prompt-Case-Hub から取得しています ― オープンソースのプロンプトリポジトリを統合し、case 形式を統一した集約リポジトリです。各カードは表示時に上流リポジトリから遅延読み込みされ、著作権は元のプロンプト作者に帰属します。',
  preview_title: 'プレビュー',
  preview_close: 'プレビューを閉じる',
  preview_prompt: 'プロンプト',
  preview_info: '情報',
  preview_model: 'モデル',
  preview_quality: '品質',
  preview_ratio: 'アスペクト比',
  preview_duration: '長さ',
  preview_filesize: 'ファイルサイズ',
  preview_date: '日付',
  preview_creator: '作成者',
  preview_download: 'ダウンロード',
  vb_fit: '画面に合わせる',
  vb_zoom_to: '{pct}% にズーム',
};

const DICT: Record<Locale, Strings> = { en, 'zh-CN': zhCN, ja };

export type StringKey = keyof typeof en;

/** React hook returning a `t(key, vars?)` translator bound to the active locale. */
export function useT(): (key: StringKey, vars?: Record<string, string | number>) => string {
  const locale = useLocaleStore((s) => s.locale);
  return (key, vars) => {
    const table = DICT[locale] ?? en;
    let s = table[key] ?? en[key] ?? String(key);
    if (vars) {
      for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    }
    return s;
  };
}
