import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, ConfigCard, TextField, PasswordField, SelectField, ArrayField, EmptyState } from '../fields';
import NumberStepper from '../../../components/NumberStepper';
import { post } from '../../../services/request';
import { getTranslation } from '../../../locales';
import { useToast } from '../../../components/Toast';

// ============================================================================
// 服务商预设
// ============================================================================
interface ModelCost {
  input: number; output: number; cacheRead: number; cacheWrite: number;
}

interface ProviderPreset {
  id: string; name: string; labelKey?: string; icon: string; category: 'builtin' | 'custom' | 'local';
  envVar: string; defaultModel: string;
  models: { id: string; name: string; ctx?: string; cost?: ModelCost }[];
  baseUrl: string; api: string; needsBaseUrl?: boolean; helpUrl?: string;
}
interface ProviderDefaultParams {
  apiType: string;
  baseUrl: string;
}

function normalizeProviderIdForMerge(input: string): string {
  const id = input.trim().toLowerCase();
  if (!id) return id;
  if (id === 'baidu' || id === 'baidu-qianfan') return 'qianfan';
  if (id === 'google' || id === 'google-gemini-cli') return 'gemini';
  if (id === 'doubao') return 'volcengine';
  if (id === 'volcengine-plan') return 'volcengine';
  if (id === 'byteplus-plan') return 'byteplus';
  if (id === 'minimax-portal') return 'minimax';
  return id;
}

const PROVIDER_DEFAULT_PARAMS: Record<string, ProviderDefaultParams> = {
  anthropic: { apiType: 'anthropic-messages', baseUrl: 'https://api.anthropic.com' },
  openai: { apiType: 'openai-completions', baseUrl: 'https://api.openai.com/v1' },
  'github-copilot': { apiType: 'github-copilot', baseUrl: 'https://api.githubcopilot.com' },
  gemini: { apiType: 'google-generative-ai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  xai: { apiType: 'openai-completions', baseUrl: 'https://api.x.ai/v1' },
  qianfan: { apiType: 'openai-completions', baseUrl: 'https://qianfan.baidubce.com/v2' },
  voyage: { apiType: 'openai-completions', baseUrl: 'https://api.voyageai.com/v1' },
  moonshot: { apiType: 'openai-completions', baseUrl: 'https://api.moonshot.ai/v1' },
  deepseek: { apiType: 'openai-completions', baseUrl: 'https://api.deepseek.com/v1' },
  yi: { apiType: 'openai-completions', baseUrl: 'https://api.lingyiwanwu.com/v1' },
  openrouter: { apiType: 'openai-completions', baseUrl: 'https://openrouter.ai/api/v1' },
  ollama: { apiType: 'openai-completions', baseUrl: 'http://localhost:11434/v1' },
  lmstudio: { apiType: 'openai-completions', baseUrl: 'http://localhost:1234/v1' },
  localai: { apiType: 'openai-completions', baseUrl: 'http://localhost:8080/v1' },
  groq: { apiType: 'openai-completions', baseUrl: 'https://api.groq.com/openai/v1' },
  cerebras: { apiType: 'openai-completions', baseUrl: 'https://api.cerebras.ai/v1' },
  mistral: { apiType: 'openai-completions', baseUrl: 'https://api.mistral.ai/v1' },
  minimax: { apiType: 'anthropic-messages', baseUrl: 'https://api.minimax.io/anthropic' },
  nvidia: { apiType: 'openai-completions', baseUrl: 'https://integrate.api.nvidia.com/v1' },
  xiaomi: { apiType: 'anthropic-messages', baseUrl: 'https://api.xiaomimimo.com/anthropic' },
  together: { apiType: 'openai-completions', baseUrl: 'https://api.together.xyz/v1' },
  huggingface: { apiType: 'openai-completions', baseUrl: 'https://router.huggingface.co/v1' },
  volcengine: { apiType: 'openai-completions', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  byteplus: { apiType: 'openai-completions', baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3' },
  chutes: { apiType: 'openai-completions', baseUrl: 'https://api.chutes.ai' },
  'kimi-coding': { apiType: 'anthropic-messages', baseUrl: 'https://api.kimi.com/coding/' },
  'qwen-portal': { apiType: 'openai-completions', baseUrl: 'https://portal.qwen.ai/v1' },
  zai: { apiType: 'openai-completions', baseUrl: 'https://api.z.ai/api/paas/v4' },
  venice: { apiType: 'openai-completions', baseUrl: 'https://api.venice.ai/api/v1' },
  synthetic: { apiType: 'anthropic-messages', baseUrl: 'https://api.synthetic.new/anthropic' },
  opencode: { apiType: 'openai-completions', baseUrl: 'https://opencode.ai/zen/v1' },
  kilocode: { apiType: 'openai-completions', baseUrl: 'https://api.kilo.ai/api/gateway/' },
  litellm: { apiType: 'openai-completions', baseUrl: 'http://localhost:4000' },
  'vercel-ai-gateway': { apiType: 'openai-completions', baseUrl: '' },
  'cloudflare-ai-gateway': { apiType: 'anthropic-messages', baseUrl: '' },
  'google-vertex': { apiType: 'google-vertex', baseUrl: '' },
  'amazon-bedrock': { apiType: 'bedrock-converse-stream', baseUrl: '' },
  vllm: { apiType: 'openai-completions', baseUrl: 'http://127.0.0.1:8000/v1' },
};

function resolveProviderDefaultParams(
  provider: string,
  fallback: ProviderDefaultParams = { apiType: 'openai-completions', baseUrl: '' },
): ProviderDefaultParams {
  const normalized = normalizeProviderIdForMerge(provider);
  return PROVIDER_DEFAULT_PARAMS[normalized] || fallback;
}

const ZH_PROVIDER_NAMES: Record<string, string> = {
  qianfan: '百度千帆',
  moonshot: '月之暗面',
  deepseek: '深度求索',
  yi: '零一万物',
  minimax: 'MiniMax',
  'kimi-coding': 'Kimi 编码',
  volcengine: '火山引擎',
  byteplus: 'BytePlus',
  zai: '智谱 Z.AI',
  xiaomi: '小米',
  'qwen-portal': '通义千问',
  synthetic: 'Synthetic',
  huggingface: 'Hugging Face',
  chutes: 'Chutes',
  'google-vertex': 'Google Vertex AI',
  'amazon-bedrock': 'Amazon Bedrock',
};

function resolveProviderDisplayName(params: { language: string; providerId: string; fallbackName: string }): string {
  const lang = params.language.toLowerCase();
  if (!lang.startsWith('zh')) return params.fallbackName;
  return ZH_PROVIDER_NAMES[params.providerId] || params.fallbackName;
}

function extractHttpStatusCode(err: any): number | null {
  const direct = Number(err?.status ?? err?.response?.status ?? err?.code);
  if (Number.isFinite(direct) && direct >= 100 && direct <= 599) return direct;
  const raw = String(err?.message || '');
  const matched = raw.match(/HTTP\s*[:\s]?(\d{3})/i) || raw.match(/\b(\d{3})\b/);
  if (!matched) return null;
  const code = Number(matched[1]);
  return Number.isFinite(code) && code >= 100 && code <= 599 ? code : null;
}

function formatFriendlyError(err: any, es: any): string {
  const raw = String(err?.message || '').trim();
  const lower = raw.toLowerCase();
  // Prefer the upstream HTTP status embedded in the error message (e.g. "HTTP 401")
  // over the ClawDeckX API response status, because test-model returns 422 to avoid
  // triggering the frontend auto-logout on upstream 401.
  const msgMatch = raw.match(/HTTP\s*[:\s]?(\d{3})/i);
  const msgStatus = msgMatch ? Number(msgMatch[1]) : null;
  const status = (msgStatus && msgStatus >= 100 && msgStatus <= 599) ? msgStatus : extractHttpStatusCode(err);
  const withStatus = (msg: string) => (status ? `${msg} (HTTP ${status})` : msg);

  if (status === 401 || status === 403) return withStatus(es.errAuthForbidden);
  if (status === 404) return withStatus(es.errEndpointNotFound);
  if (status === 429) return withStatus(es.errRateLimited);
  if (status && status >= 500) return withStatus(es.errServerUnavailable);
  if (lower.includes('<!doctype') || lower.includes('<html')) {
    return withStatus(es.errEndpointReturnedHtml);
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('ecconnrefused') || lower.includes('timeout')) {
    return es.errNetworkUnavailable;
  }
  if (raw) return raw.length > 200 ? `${raw.slice(0, 200)}...` : raw;
  return es.errOperationFailed || es.failed;
}

const PROVIDERS: ProviderPreset[] = [
  { id: 'anthropic', name: 'Anthropic', icon: '🅰️', category: 'builtin', envVar: 'ANTHROPIC_API_KEY', defaultModel: 'claude-sonnet-4-5', models: [
    { id: 'claude-opus-4-6', name: 'Claude Opus 4', ctx: '200K', cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 } },
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', ctx: '200K', cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
    { id: 'claude-sonnet-4-1', name: 'Claude Sonnet 4.1', ctx: '200K', cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } }
  ], baseUrl: 'https://api.anthropic.com', api: 'anthropic-messages', helpUrl: 'https://console.anthropic.com' },
  { id: 'openai', name: 'OpenAI', icon: '🤖', category: 'builtin', envVar: 'OPENAI_API_KEY', defaultModel: 'gpt-4o', models: [
    { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', ctx: '256K', cost: { input: 5, output: 15, cacheRead: 2.5, cacheWrite: 5 } },
    { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', ctx: '256K', cost: { input: 5, output: 15, cacheRead: 2.5, cacheWrite: 5 } },
    { id: 'gpt-4o', name: 'GPT-4o', ctx: '128K', cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 } },
    { id: 'o3', name: 'o3', ctx: '200K', cost: { input: 10, output: 40, cacheRead: 5, cacheWrite: 10 } }
  ], baseUrl: 'https://api.openai.com/v1', api: 'openai-completions', helpUrl: 'https://platform.openai.com' },
  { id: 'github-copilot', name: 'GitHub Copilot', icon: '🐙', category: 'builtin', envVar: 'GITHUB_COPILOT_TOKEN', defaultModel: 'gpt-5.2-codex', models: [
    { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', ctx: '256K', cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    { id: 'gpt-5.2', name: 'GPT-5.2', ctx: '128K', cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
  ], baseUrl: 'https://api.githubcopilot.com', api: 'github-copilot', helpUrl: 'https://github.com/features/copilot' },
  { id: 'gemini', name: 'Google Gemini', icon: '✨', category: 'builtin', envVar: 'GEMINI_API_KEY', defaultModel: 'gemini-3-pro', models: [
    { id: 'gemini-3-pro', name: 'Gemini 3 Pro', ctx: '2M', cost: { input: 1.25, output: 5, cacheRead: 0.3, cacheWrite: 1.25 } },
    { id: 'gemini-3-flash', name: 'Gemini 3 Flash', ctx: '2M', cost: { input: 0.075, output: 0.3, cacheRead: 0.02, cacheWrite: 0.075 } }
  ], baseUrl: 'https://generativelanguage.googleapis.com/v1beta', api: 'openai-completions', helpUrl: 'https://aistudio.google.com' },
  { id: 'xai', name: 'xAI (Grok)', icon: '✖️', category: 'builtin', envVar: 'XAI_API_KEY', defaultModel: 'grok-2', models: [
    { id: 'grok-2', name: 'Grok 2', ctx: '128K', cost: { input: 2, output: 10, cacheRead: 0.5, cacheWrite: 2 } },
    { id: 'grok-beta', name: 'Grok Beta', ctx: '128K', cost: { input: 5, output: 15, cacheRead: 1.25, cacheWrite: 5 } }
  ], baseUrl: 'https://api.x.ai/v1', api: 'openai-completions', helpUrl: 'https://x.ai/api' },
  { id: 'qianfan', name: 'Baidu Qianfan', icon: '🐼', category: 'builtin', envVar: 'QIANFAN_API_KEY', defaultModel: 'ernie-4.0', models: [
    { id: 'ernie-4.0', name: 'ERNIE 4.0', ctx: '8K', cost: { input: 0.12, output: 0.12, cacheRead: 0, cacheWrite: 0 } },
    { id: 'ernie-bot-turbo', name: 'ERNIE Bot Turbo', ctx: '8K', cost: { input: 0.008, output: 0.008, cacheRead: 0, cacheWrite: 0 } }
  ], baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop', api: 'openai-completions', helpUrl: 'https://cloud.baidu.com/doc/WENXINWORKSHOP/index.html' },
  { id: 'voyage', name: 'Voyage AI', icon: '🛶', category: 'builtin', envVar: 'VOYAGE_API_KEY', defaultModel: 'voyage-large-2', models: [
    { id: 'voyage-large-2', name: 'Voyage Large 2', ctx: '32K', cost: { input: 0.12, output: 0.12, cacheRead: 0, cacheWrite: 0 } },
    { id: 'voyage-code-2', name: 'Voyage Code 2', ctx: '32K', cost: { input: 0.12, output: 0.12, cacheRead: 0, cacheWrite: 0 } }
  ], baseUrl: 'https://api.voyageai.com/v1', api: 'openai-completions', helpUrl: 'https://docs.voyageai.com' },
  { id: 'moonshot', name: 'Moonshot', icon: '🌑', category: 'builtin', envVar: 'MOONSHOT_API_KEY', defaultModel: 'moonshot-v1-8k', models: [
    { id: 'moonshot-v1-8k', name: 'Moonshot V1 8K', ctx: '8K', cost: { input: 0.012, output: 0.012, cacheRead: 0, cacheWrite: 0 } },
    { id: 'moonshot-v1-32k', name: 'Moonshot V1 32K', ctx: '32K', cost: { input: 0.024, output: 0.024, cacheRead: 0, cacheWrite: 0 } },
    { id: 'moonshot-v1-128k', name: 'Moonshot V1 128K', ctx: '128K', cost: { input: 0.06, output: 0.06, cacheRead: 0, cacheWrite: 0 } }
  ], baseUrl: 'https://api.moonshot.cn/v1', api: 'openai-completions', helpUrl: 'https://platform.moonshot.cn' },
  { id: 'deepseek', name: 'DeepSeek', icon: '🐋', category: 'builtin', envVar: 'DEEPSEEK_API_KEY', defaultModel: 'deepseek-chat', models: [
    { id: 'deepseek-chat', name: 'DeepSeek Chat', ctx: '32K', cost: { input: 0.14, output: 0.28, cacheRead: 0.014, cacheWrite: 0.14 } },
    { id: 'deepseek-coder', name: 'DeepSeek Coder', ctx: '32K', cost: { input: 0.14, output: 0.28, cacheRead: 0.014, cacheWrite: 0.14 } }
  ], baseUrl: 'https://api.deepseek.com/v1', api: 'openai-completions', helpUrl: 'https://platform.deepseek.com' },
  { id: 'yi', name: 'Yi (01.AI)', icon: '🟢', category: 'builtin', envVar: 'YI_API_KEY', defaultModel: 'yi-large', models: [
    { id: 'yi-large', name: 'Yi Large', ctx: '32K', cost: { input: 0.02, output: 0.02, cacheRead: 0, cacheWrite: 0 } },
    { id: 'yi-medium', name: 'Yi Medium', ctx: '16K', cost: { input: 0.0025, output: 0.0025, cacheRead: 0, cacheWrite: 0 } },
    { id: 'yi-vision', name: 'Yi Vision', ctx: '16K', cost: { input: 0.006, output: 0.006, cacheRead: 0, cacheWrite: 0 } }
  ], baseUrl: 'https://api.lingyiwanwu.com/v1', api: 'openai-completions', helpUrl: 'https://platform.lingyiwanwu.com' },
  { id: 'groq', name: 'Groq', icon: '⚡', category: 'builtin', envVar: 'GROQ_API_KEY', defaultModel: 'llama-3.3-70b-versatile', models: [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', ctx: '128K' }
  ], baseUrl: 'https://api.groq.com/openai/v1', api: 'openai-completions', helpUrl: 'https://console.groq.com' },
  { id: 'cerebras', name: 'Cerebras', icon: '🧠', category: 'builtin', envVar: 'CEREBRAS_API_KEY', defaultModel: 'llama-3.3-70b', models: [
    { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', ctx: '128K' }
  ], baseUrl: 'https://api.cerebras.ai/v1', api: 'openai-completions', helpUrl: 'https://cloud.cerebras.ai' },
  { id: 'openrouter', name: 'OpenRouter', icon: '🔀', category: 'builtin', envVar: 'OPENROUTER_API_KEY', defaultModel: 'auto', models: [
    { id: 'auto', name: 'Auto Router', ctx: '200K' }
  ], baseUrl: 'https://openrouter.ai/api/v1', api: 'openai-completions', helpUrl: 'https://openrouter.ai' },
  { id: 'mistral', name: 'Mistral AI', icon: '🌊', category: 'builtin', envVar: 'MISTRAL_API_KEY', defaultModel: 'mistral-large-latest', models: [
    { id: 'mistral-large-latest', name: 'Mistral Large', ctx: '256K' }
  ], baseUrl: 'https://api.mistral.ai/v1', api: 'openai-completions', helpUrl: 'https://console.mistral.ai' },
  { id: 'minimax', name: 'MiniMax', icon: 'Ⓜ️', category: 'builtin', envVar: 'MINIMAX_API_KEY', defaultModel: 'MiniMax-M2.5', models: [
    { id: 'MiniMax-M2.5', name: 'MiniMax M2.5', ctx: '200K', cost: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.12 } },
    { id: 'MiniMax-M2.5-highspeed', name: 'MiniMax M2.5 Highspeed', ctx: '200K', cost: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.12 } },
    { id: 'MiniMax-VL-01', name: 'MiniMax VL 01', ctx: '200K', cost: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.12 } }
  ], baseUrl: 'https://api.minimax.io/anthropic', api: 'anthropic-messages', helpUrl: 'https://platform.minimaxi.com' },
  { id: 'nvidia', name: 'NVIDIA NIM', icon: '🟩', category: 'builtin', envVar: 'NVIDIA_API_KEY', defaultModel: 'nvidia/llama-3.1-nemotron-70b-instruct', models: [
    { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70B', ctx: '128K' },
    { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', ctx: '128K' }
  ], baseUrl: 'https://integrate.api.nvidia.com/v1', api: 'openai-completions', helpUrl: 'https://build.nvidia.com' },
  { id: 'xiaomi', name: 'Xiaomi MiMo', icon: '📱', category: 'builtin', envVar: 'XIAOMI_API_KEY', defaultModel: 'mimo-v2-flash', models: [
    { id: 'mimo-v2-flash', name: 'MiMo V2 Flash', ctx: '256K' }
  ], baseUrl: 'https://api.xiaomimimo.com/anthropic', api: 'anthropic-messages', helpUrl: 'https://dev.mi.com' },
  { id: 'together', name: 'Together AI', icon: '🤝', category: 'builtin', envVar: 'TOGETHER_API_KEY', defaultModel: 'moonshotai/Kimi-K2.5', models: [], baseUrl: 'https://api.together.xyz/v1', api: 'openai-completions', helpUrl: 'https://api.together.ai' },
  { id: 'huggingface', name: 'Hugging Face', icon: '🤗', category: 'builtin', envVar: 'HF_TOKEN', defaultModel: 'deepseek-ai/DeepSeek-R1', models: [], baseUrl: 'https://router.huggingface.co/v1', api: 'openai-completions', helpUrl: 'https://huggingface.co/inference-api' },
  { id: 'volcengine', name: 'Volcengine', icon: '🌋', category: 'builtin', envVar: 'VOLCANO_ENGINE_API_KEY', defaultModel: 'doubao-seed-1-8-251228', models: [
    { id: 'doubao-seed-1-8-251228', name: 'Doubao Seed 1.8', ctx: '128K' }
  ], baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', api: 'openai-completions', helpUrl: 'https://www.volcengine.com/product/doubao' },
  { id: 'byteplus', name: 'BytePlus', icon: '🔷', category: 'builtin', envVar: 'BYTEPLUS_API_KEY', defaultModel: 'seed-1-8-251228', models: [
    { id: 'seed-1-8-251228', name: 'Seed 1.8', ctx: '128K' }
  ], baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3', api: 'openai-completions', helpUrl: 'https://www.byteplus.com' },
  { id: 'chutes', name: 'Chutes', icon: '🪂', category: 'builtin', envVar: 'CHUTES_API_KEY', defaultModel: 'deepseek-ai/DeepSeek-R1', models: [], baseUrl: 'https://api.chutes.ai', api: 'openai-completions', helpUrl: 'https://chutes.ai' },
  { id: 'kimi-coding', name: 'Kimi Coding', icon: '🌙', category: 'builtin', envVar: 'KIMI_API_KEY', defaultModel: 'k2p5', models: [
    { id: 'k2p5', name: 'Kimi for Coding', ctx: '256K' }
  ], baseUrl: 'https://api.kimi.com/coding/', api: 'anthropic-messages', helpUrl: 'https://kimi.ai' },
  { id: 'qwen-portal', name: 'Qwen Portal', icon: '🔮', category: 'builtin', envVar: 'QWEN_PORTAL_API_KEY', defaultModel: 'coder-model', models: [
    { id: 'coder-model', name: 'Qwen Coder', ctx: '128K' },
    { id: 'vision-model', name: 'Qwen Vision', ctx: '128K' }
  ], baseUrl: 'https://portal.qwen.ai/v1', api: 'openai-completions', helpUrl: 'https://portal.qwen.ai' },
  { id: 'zai', name: 'Zhipu Z.AI', icon: '🧿', category: 'builtin', envVar: 'ZAI_API_KEY', defaultModel: 'glm-5', models: [
    { id: 'glm-5', name: 'GLM-5', ctx: '200K' },
    { id: 'glm-4.7', name: 'GLM-4.7', ctx: '200K' },
    { id: 'glm-4.7-flash', name: 'GLM-4.7 Flash', ctx: '200K' }
  ], baseUrl: 'https://api.z.ai/api/paas/v4', api: 'openai-completions', helpUrl: 'https://open.bigmodel.cn' },
  { id: 'venice', name: 'Venice AI', icon: '🏛️', category: 'builtin', envVar: 'VENICE_API_KEY', defaultModel: 'llama-3.3-70b', models: [], baseUrl: 'https://api.venice.ai/api/v1', api: 'openai-completions', helpUrl: 'https://venice.ai' },
  { id: 'synthetic', name: 'Synthetic', icon: '🧪', category: 'builtin', envVar: 'SYNTHETIC_API_KEY', defaultModel: 'hf:MiniMaxAI/MiniMax-M2.5', models: [
    { id: 'hf:MiniMaxAI/MiniMax-M2.5', name: 'MiniMax M2.5', ctx: '200K' }
  ], baseUrl: 'https://api.synthetic.new/anthropic', api: 'anthropic-messages', helpUrl: 'https://synthetic.new' },
  { id: 'opencode', name: 'OpenCode Zen', icon: '💻', category: 'builtin', envVar: 'OPENCODE_API_KEY', defaultModel: 'claude-opus-4-6', models: [
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', ctx: '200K' }
  ], baseUrl: 'https://opencode.ai/zen/v1', api: 'openai-completions', helpUrl: 'https://opencode.ai' },
  { id: 'kilocode', name: 'KiloCode', icon: '📊', category: 'builtin', envVar: 'KILOCODE_API_KEY', defaultModel: 'anthropic/claude-opus-4.6', models: [
    { id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6', ctx: '200K' }
  ], baseUrl: 'https://api.kilo.ai/api/gateway/', api: 'openai-completions', helpUrl: 'https://kilo.ai' },
  { id: 'vercel-ai-gateway', name: 'Vercel AI Gateway', icon: '▲', category: 'builtin', envVar: 'AI_GATEWAY_API_KEY', defaultModel: 'anthropic/claude-opus-4.6', models: [], baseUrl: '', api: 'openai-completions', needsBaseUrl: true, helpUrl: 'https://vercel.com/docs/ai-gateway' },
  { id: 'cloudflare-ai-gateway', name: 'Cloudflare AI Gateway', icon: '☁️', category: 'builtin', envVar: 'CLOUDFLARE_AI_GATEWAY_API_KEY', defaultModel: 'claude-opus-4-6', models: [], baseUrl: '', api: 'anthropic-messages', needsBaseUrl: true, helpUrl: 'https://developers.cloudflare.com/ai-gateway' },
  { id: 'google-vertex', name: 'Google Vertex AI', icon: '🔶', category: 'builtin', envVar: '', defaultModel: 'gemini-3-pro', models: [
    { id: 'gemini-3-pro', name: 'Gemini 3 Pro', ctx: '2M' }
  ], baseUrl: '', api: 'google-vertex', needsBaseUrl: true, helpUrl: 'https://cloud.google.com/vertex-ai' },
  { id: 'amazon-bedrock', name: 'Amazon Bedrock', icon: '🟠', category: 'builtin', envVar: 'AWS_PROFILE', defaultModel: 'anthropic.claude-opus-4-6', models: [], baseUrl: '', api: 'bedrock-converse-stream', needsBaseUrl: true, helpUrl: 'https://aws.amazon.com/bedrock' },
  { id: 'ollama', name: 'Ollama', icon: '🦙', category: 'local', envVar: '', defaultModel: 'llama3', models: [], baseUrl: 'http://localhost:11434/v1', api: 'openai-completions', helpUrl: 'https://ollama.com' },
  { id: 'lmstudio', name: 'LM Studio', icon: '🖥️', category: 'local', envVar: '', defaultModel: 'local-model', models: [], baseUrl: 'http://localhost:1234/v1', api: 'openai-completions', helpUrl: 'https://lmstudio.ai' },
  { id: 'localai', name: 'LocalAI', icon: '🏠', category: 'local', envVar: '', defaultModel: 'gpt-3.5-turbo', models: [], baseUrl: 'http://localhost:8080/v1', api: 'openai-completions', helpUrl: 'https://localai.io' },
  { id: 'vllm', name: 'vLLM', icon: '⚙️', category: 'local', envVar: 'VLLM_API_KEY', defaultModel: '', models: [], baseUrl: 'http://127.0.0.1:8000/v1', api: 'openai-completions', helpUrl: 'https://docs.vllm.ai' },
  { id: 'litellm', name: 'LiteLLM', icon: '🔗', category: 'local', envVar: 'LITELLM_API_KEY', defaultModel: 'claude-opus-4-6', models: [], baseUrl: 'http://localhost:4000', api: 'openai-completions', helpUrl: 'https://litellm.ai' },
  { id: 'custom', name: 'Custom', labelKey: 'customProvider', icon: '⚙️', category: 'custom', envVar: '', defaultModel: '', models: [], baseUrl: '', api: 'openai-completions', needsBaseUrl: true },
];

// Options moved inside component

// ============================================================================
// Accordion Step 组件
// ============================================================================
interface AccordionStepProps {
  stepNum: number;
  icon: string;
  title: string;
  summary?: string;
  open: boolean;
  done: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const AccordionStep: React.FC<AccordionStepProps> = ({ stepNum, icon, title, summary, open, done, onToggle, children }) => (
  <div className={`border rounded-xl transition-colors ${open ? 'overflow-visible border-primary/40 bg-white dark:bg-white/[0.02]' : 'overflow-hidden ' + (done ? 'border-green-300 dark:border-green-500/30 bg-green-50/50 dark:bg-green-500/5' : 'border-slate-200 dark:border-white/[0.06] bg-slate-50 dark:bg-white/[0.01]')}`}>
    <div className={`flex items-center gap-2.5 px-4 py-3 cursor-pointer transition-colors ${open ? '' : 'hover:bg-slate-100 dark:hover:bg-white/[0.03]'}`} onClick={onToggle}>
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${done ? 'bg-green-500 text-white' : open ? 'bg-primary text-white' : 'bg-slate-200 dark:bg-white/10 text-slate-500 dark:text-white/40'}`}>
        {done ? <span className="material-symbols-outlined text-[14px]">check</span> : stepNum}
      </div>
      <span className={`material-symbols-outlined text-[16px] ${done ? 'text-green-500' : open ? 'text-primary' : 'text-slate-400 dark:text-white/40'}`}>{icon}</span>
      <div className="flex-1 min-w-0">
        <span className={`text-xs font-bold ${open ? 'text-slate-800 dark:text-white' : 'text-slate-600 dark:text-white/60'}`}>{title}</span>
        {!open && summary && <p className="text-[10px] text-slate-400 dark:text-white/40 truncate">{summary}</p>}
      </div>
      <span className={`material-symbols-outlined text-[16px] text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}>expand_more</span>
    </div>
    {open && <div className="px-4 pb-4 border-t border-slate-100 dark:border-white/[0.04]">{children}</div>}
  </div>
);

// ============================================================================
// 模型路径搜索组件（provider/model-id 自动补全）
// ============================================================================
interface ModelPathSearchProps {
  value: string;
  onChange: (v: string) => void;
  options: { path: string; provider: string; model: string; name?: string }[];
  placeholder?: string;
  exclude?: string[];
  clearOnSelect?: boolean;
}

const ModelPathSearch: React.FC<ModelPathSearchProps> = ({ value, onChange, options, placeholder, exclude, clearOnSelect }) => {
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(-1);
  const [localInput, setLocalInput] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const displayValue = clearOnSelect ? localInput : value;

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const q = displayValue.toLowerCase();
  const filtered = options.filter(o =>
    (!exclude || !exclude.includes(o.path)) &&
    (!q || o.path.toLowerCase().includes(q) || (o.name && o.name.toLowerCase().includes(q)))
  );

  const handleSelect = (path: string) => {
    onChange(path);
    if (clearOnSelect) setLocalInput('');
    setOpen(false); setHl(-1);
  };

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <span className="material-symbols-outlined text-[14px] text-slate-400 absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none">search</span>
        <input type="text" value={displayValue}
          onChange={e => {
            if (clearOnSelect) setLocalInput(e.target.value);
            else onChange(e.target.value);
            setOpen(true); setHl(-1);
          }}
          onFocus={() => { setOpen(true); setHl(-1); }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown' && open && filtered.length > 0) { e.preventDefault(); setHl(i => (i + 1) % filtered.length); }
            else if (e.key === 'ArrowUp' && open && filtered.length > 0) { e.preventDefault(); setHl(i => (i <= 0 ? filtered.length - 1 : i - 1)); }
            else if (e.key === 'Enter') {
              e.preventDefault();
              if (hl >= 0 && hl < filtered.length) handleSelect(filtered[hl].path);
              else if (displayValue.trim()) handleSelect(displayValue.trim());
            } else if (e.key === 'Escape') { setOpen(false); setHl(-1); }
          }}
          placeholder={placeholder}
          className="w-full h-8 ps-8 pe-3 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-primary" />
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute start-0 end-0 mt-1 max-h-48 overflow-y-auto custom-scrollbar rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#2a2a2e] shadow-xl z-50">
          {filtered.map((o, idx) => (
            <button key={o.path}
              onMouseEnter={() => setHl(idx)}
              onClick={() => handleSelect(o.path)}
              ref={el => { if (idx === hl && el) el.scrollIntoView({ block: 'nearest' }); }}
              className={`w-full text-start px-3 py-2 flex items-center gap-2 transition-colors border-b border-slate-100 dark:border-white/[0.04] last:border-b-0 ${idx === hl ? 'bg-primary/10 dark:bg-primary/20' : 'hover:bg-slate-50 dark:hover:bg-white/[0.04]'}`}>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-mono font-bold text-slate-700 dark:text-white/80 truncate">{o.path}</div>
                {o.name && o.name !== o.model && <div className="text-[11px] text-slate-400 truncate">{o.name}</div>}
              </div>
              <span className="text-[11px] px-1.5 py-0.5 bg-slate-100 dark:bg-white/[0.06] text-slate-500 dark:text-white/40 rounded shrink-0">{o.provider}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// ModelsSection
// ============================================================================
export const ModelsSection: React.FC<SectionProps> = ({ config, setField, getField, deleteField, language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const { toast } = useToast();

  const API_OPTIONS = useMemo(() => [
    { value: 'openai-completions', label: 'OpenAI' },
    { value: 'anthropic-messages', label: 'Anthropic' },
    { value: 'google-generative-ai', label: 'Google' },
    { value: 'openai-responses', label: 'OpenAI Responses' },
    { value: 'bedrock-converse-stream', label: 'AWS Bedrock' },
    { value: 'github-copilot', label: 'GitHub Copilot' },
  ], []);

  const AUTH_OPTIONS = useMemo(() => [
    { value: 'api-key', label: es.authApiKey },
    { value: 'oauth', label: es.authOauth },
    { value: 'aws-sdk', label: es.authAwsSdk },
    { value: 'token', label: es.authToken },
  ], [es]);

  // 已有服务商
  const providers = getField(['models', 'providers']) || {};
  const providerEntries = Object.entries(providers);
  const primaryModel = getField(['agents', 'defaults', 'model', 'primary']) || '';
  const rawFallbacks = getField(['agents', 'defaults', 'model', 'fallbacks']);
  const fallbacks: string[] = Array.isArray(rawFallbacks) ? rawFallbacks : [];

  // 所有已配置的 provider/model 路径（用于全局模型选择器）
  const allModelPaths = useMemo(() => {
    const paths: { path: string; provider: string; model: string; name?: string }[] = [];
    for (const [pName, pCfg] of Object.entries(providers) as [string, any][]) {
      const models = Array.isArray(pCfg?.models) ? pCfg.models : [];
      for (const m of models) {
        const id = typeof m === 'string' ? m : m?.id;
        if (id) paths.push({ path: `${pName}/${id}`, provider: pName, model: id, name: typeof m === 'object' ? m.name : undefined });
      }
    }
    return paths;
  }, [providers]);

  // 添加模型弹窗
  const [showAddModel, setShowAddModel] = useState<string | null>(null);
  const [newModel, setNewModel] = useState({ 
    id: '', name: '', reasoning: false, contextWindow: '',
    cost: { input: '', output: '', cacheRead: '', cacheWrite: '' }
  });

  // 向导状态
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [wizApiKey, setWizApiKey] = useState('');
  const [wizShowKey, setWizShowKey] = useState(false);
  const [wizBaseUrl, setWizBaseUrl] = useState('');
  const [wizApiType, setWizApiType] = useState('openai-completions');
  const [wizModels, setWizModels] = useState<string[]>([]);
  const [wizModelCosts, setWizModelCosts] = useState<Record<string, { input: string; output: string; cacheRead: string; cacheWrite: string }>>({});
  const [wizExpandedCost, setWizExpandedCost] = useState<string | null>(null);
  const [wizSearchInput, setWizSearchInput] = useState('');
  const [wizCustomName, setWizCustomName] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail' | 'warning'>('idle');
  const [modelSearchOpen, setModelSearchOpen] = useState(false);
  const [modelHighlight, setModelHighlight] = useState(-1);
  const [discoveringModels, setDiscoveringModels] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<{ id: string; name: string; ctx?: string; cost?: ModelCost }[]>([]);
  const [autoDiscoverAttemptKey, setAutoDiscoverAttemptKey] = useState('');
  const modelSearchRef = useRef<HTMLDivElement>(null);
  const modelListRef = useRef<HTMLDivElement>(null);
  const [providerTestStatus, setProviderTestStatus] = useState<Record<string, 'idle' | 'testing' | 'ok' | 'fail' | 'warning'>>({});
  const [addModelDiscovering, setAddModelDiscovering] = useState(false);
  const [addModelDiscovered, setAddModelDiscovered] = useState<{ id: string; name?: string }[]>([]);
  const [addModelSearchOpen, setAddModelSearchOpen] = useState(false);
  const [addModelHighlight, setAddModelHighlight] = useState(-1);
  const addModelSearchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!modelSearchOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelSearchRef.current && !modelSearchRef.current.contains(e.target as Node)) setModelSearchOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelSearchOpen]);

  useEffect(() => {
    if (!addModelSearchOpen) return;
    const handler = (e: MouseEvent) => {
      if (addModelSearchRef.current && !addModelSearchRef.current.contains(e.target as Node)) setAddModelSearchOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [addModelSearchOpen]);

  useEffect(() => {
    if (showAddModel) discoverModelsForProvider(showAddModel);
  }, [showAddModel]);

  const preset = PROVIDERS.find(p => p.id === selectedProvider);
  const wizFinalModel = wizModels[0] || '';
  const providerCardsByCategory = useMemo(() => {
    const cards = PROVIDERS.map((p) => {
      const baseName = p.labelKey ? (es as any)[p.labelKey] || p.name : p.name;
      return {
        id: p.id,
        name: resolveProviderDisplayName({ language, providerId: p.id, fallbackName: baseName }),
        category: p.category,
      };
    });
    return {
      builtin: cards.filter(p => p.category === 'builtin').sort((a, b) => a.name.localeCompare(b.name)),
      custom: cards.filter(p => p.category === 'custom').sort((a, b) => a.name.localeCompare(b.name)),
      local: cards.filter(p => p.category === 'local').sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [es, language]);
  const wizardModelCandidates = useMemo(() => {
    const merged = new Map<string, { id: string; name: string; ctx?: string; cost?: ModelCost }>();
    for (const m of preset?.models || []) merged.set(m.id, m);
    for (const m of discoveredModels) {
      if (!merged.has(m.id)) merged.set(m.id, m);
    }
    return Array.from(merged.values());
  }, [preset, discoveredModels]);
  const selectedPresetDisplayName = useMemo(() => {
    if (!preset) return '';
    const baseName = preset.labelKey ? (es as any)[preset.labelKey] || preset.name : preset.name;
    return resolveProviderDisplayName({ language, providerId: preset.id, fallbackName: baseName });
  }, [preset, es, language]);
  const selectedProviderDefaults = useMemo(() => {
    if (!preset) return { apiType: 'openai-completions', baseUrl: '' };
    return resolveProviderDefaultParams(preset.id, { apiType: preset.api, baseUrl: preset.baseUrl });
  }, [preset]);
  const autoDiscoverKey = useMemo(
    () => [selectedProvider, wizApiType, wizBaseUrl.trim(), String(wizApiKey.length)].join('|'),
    [selectedProvider, wizApiType, wizBaseUrl, wizApiKey]
  );

  const resetWizard = useCallback(() => {
    setWizardStep(0);
    setSelectedProvider('');
    setWizApiKey('');
    setWizShowKey(false);
    setWizBaseUrl('');
    setWizApiType('openai-completions');
    setWizModels([]);
    setWizModelCosts({});
    setWizExpandedCost(null);
    setWizSearchInput('');
    setWizCustomName('');
    setTestStatus('idle');
    setModelSearchOpen(false);
    setDiscoveredModels([]);
    setDiscoveringModels(false);
    setAutoDiscoverAttemptKey('');
  }, []);

  const handleSelectProvider = useCallback((id: string) => {
    setSelectedProvider(id);
    const p = PROVIDERS.find(x => x.id === id);
    if (p) {
      const defaults = resolveProviderDefaultParams(id, { apiType: p.api, baseUrl: p.baseUrl });
      setWizBaseUrl(defaults.baseUrl);
      setWizApiType(defaults.apiType);
      if (p.defaultModel) setWizModels([p.defaultModel]);
      else setWizModels([]);
      setWizSearchInput('');
      setAutoDiscoverAttemptKey('');
    }
    setWizardStep(1);
  }, []);

  const discoverModelsForWizard = useCallback(async () => {
    if (!selectedProvider) return;
    setDiscoveringModels(true);
    try {
      const data = await post<{ models?: { id: string; name?: string }[] }>('/api/v1/setup/discover-models', {
        provider: selectedProvider,
        apiKey: wizApiKey,
        baseUrl: wizBaseUrl,
        apiType: wizApiType,
      });
      const list = Array.isArray(data?.models)
        ? data.models
            .filter((m: any) => m && typeof m.id === 'string' && m.id.trim())
            .map((m: any) => ({ id: m.id.trim(), name: (m.name || m.id).trim() }))
        : [];
      setDiscoveredModels(list);
      if (list.length > 0) {
        toast('success', `${es.discoverModelsOk} (${list.length})`);
      } else {
        toast('warning', es.discoverModelsEmpty);
      }
    } catch (err: any) {
      toast('error', formatFriendlyError(err, es) || es.discoverModelsFail || es.failed);
    } finally {
      setDiscoveringModels(false);
    }
  }, [selectedProvider, wizApiKey, wizBaseUrl, wizApiType, toast, es]);

  const handleTestConnection = useCallback(async () => {
    setTestStatus('testing');
    try {
      const result = await post<{ status?: string; message?: string }>('/api/v1/setup/test-model', {
        provider: selectedProvider,
        apiKey: wizApiKey,
        baseUrl: wizBaseUrl,
        model: wizFinalModel,
        apiType: wizApiType,
      });
      if (result?.status === 'warning') {
        setTestStatus('warning');
        toast('warning', result.message || es.connected);
      } else {
        setTestStatus('ok');
        toast('success', es.connected);
      }
    } catch (err: any) {
      setTestStatus('fail');
      toast('error', formatFriendlyError(err, es) || es.failed);
    }
    setTimeout(() => setTestStatus('idle'), 3000);
  }, [selectedProvider, wizApiKey, wizBaseUrl, wizFinalModel, toast, es]);

  const handleTestProvider = useCallback(async (providerName: string, cfg: any) => {
    setProviderTestStatus(prev => ({ ...prev, [providerName]: 'testing' }));
    try {
      const models = Array.isArray(cfg.models) ? cfg.models : [];
      const firstModel = models.length > 0 ? (typeof models[0] === 'string' ? models[0] : models[0]?.id) : '';
      const result = await post<{ status?: string; message?: string }>('/api/v1/setup/test-model', {
        provider: providerName,
        apiKey: cfg.apiKey || '',
        baseUrl: cfg.baseUrl || '',
        model: firstModel,
        apiType: cfg.api || 'openai-completions',
      });
      if (result?.status === 'warning') {
        setProviderTestStatus(prev => ({ ...prev, [providerName]: 'warning' }));
        toast('warning', result.message || es.connected);
      } else {
        setProviderTestStatus(prev => ({ ...prev, [providerName]: 'ok' }));
        toast('success', es.connected);
      }
    } catch (err: any) {
      setProviderTestStatus(prev => ({ ...prev, [providerName]: 'fail' }));
      toast('error', formatFriendlyError(err, es) || es.failed);
    }
    setTimeout(() => setProviderTestStatus(prev => ({ ...prev, [providerName]: 'idle' })), 3000);
  }, [toast, es]);

  const discoverModelsForProvider = useCallback(async (providerName: string) => {
    const cfg = getField(['models', 'providers', providerName]) as any;
    if (!cfg) return;
    setAddModelDiscovering(true);
    try {
      const normalizedId = normalizeProviderIdForMerge(providerName);
      const data = await post<{ models?: { id: string; name?: string }[] }>('/api/v1/setup/discover-models', {
        provider: normalizedId,
        apiKey: cfg.apiKey || '',
        baseUrl: cfg.baseUrl || '',
        apiType: cfg.api || 'openai-completions',
      });
      const list = Array.isArray(data?.models)
        ? data.models
            .filter((m: any) => m && typeof m.id === 'string' && m.id.trim())
            .map((m: any) => ({ id: m.id.trim(), name: (m.name || m.id).trim() }))
        : [];
      setAddModelDiscovered(list);
      if (list.length > 0) {
        toast('success', `${es.discoverModelsOk} (${list.length})`);
      } else {
        toast('warning', es.discoverModelsEmpty);
      }
    } catch (err: any) {
      toast('error', formatFriendlyError(err, es) || es.discoverModelsFail || es.failed);
    } finally {
      setAddModelDiscovering(false);
    }
  }, [getField, toast, es]);

  const handleWizardSave = useCallback(() => {
    if (!preset || wizModels.length === 0) return;
    const providerName = preset.id === 'custom' ? (wizCustomName.trim() || wizBaseUrl.replace(/https?:\/\//, '').split('/')[0] || 'custom') : preset.id;
    const defaults = resolveProviderDefaultParams(providerName, { apiType: preset.api, baseUrl: preset.baseUrl });
    // 构建模型列表，包含自定义或预设费用配置
    const modelsWithCost = wizModels.map(id => {
      const presetModel = wizardModelCandidates.find(m => m.id === id);
      const customCost = wizModelCosts[id];
      const m: any = { id, name: presetModel?.name || id };
      // 优先使用自定义费用，否则使用预设费用
      if (customCost && (customCost.input || customCost.output || customCost.cacheRead || customCost.cacheWrite)) {
        const cost: any = {};
        if (customCost.input) cost.input = Number(customCost.input);
        if (customCost.output) cost.output = Number(customCost.output);
        if (customCost.cacheRead) cost.cacheRead = Number(customCost.cacheRead);
        if (customCost.cacheWrite) cost.cacheWrite = Number(customCost.cacheWrite);
        if (Object.keys(cost).length > 0) m.cost = cost;
      } else if (presetModel?.cost) {
        m.cost = presetModel.cost;
      }
      return m;
    });
    const pCfg: any = {
      baseUrl: wizBaseUrl || defaults.baseUrl,
      api: wizApiType || defaults.apiType,
      models: modelsWithCost,
    };
    if (wizApiKey) pCfg.apiKey = wizApiKey;
    setField(['models', 'providers', providerName], pCfg);
    setField(['agents', 'defaults', 'model', 'primary'], `${providerName}/${wizModels[0]}`);
    if (wizModels.length > 1) {
      setField(['agents', 'defaults', 'model', 'fallbacks'], wizModels.slice(1).map(id => `${providerName}/${id}`));
    }
    resetWizard();
    setWizardOpen(false);
  }, [preset, wizApiKey, wizBaseUrl, wizApiType, wizModels, wizModelCosts, wizCustomName, setField, resetWizard, wizardModelCandidates]);

  const setPrimary = useCallback((path: string) => {
    setField(['agents', 'defaults', 'model', 'primary'], path);
  }, [setField]);

  const toggleFallback = useCallback((path: string) => {
    const fb = [...fallbacks];
    const idx = fb.indexOf(path);
    if (idx >= 0) fb.splice(idx, 1); else fb.push(path);
    setField(['agents', 'defaults', 'model', 'fallbacks'], fb);
  }, [fallbacks, setField]);

  const addModel = useCallback(() => {
    if (!showAddModel || !newModel.id.trim()) return;
    const rawModels = getField(['models', 'providers', showAddModel, 'models']);
    const models = Array.isArray(rawModels) ? rawModels : [];
    const m: any = { id: newModel.id.trim() };
    if (newModel.name.trim()) m.name = newModel.name.trim();
    if (newModel.reasoning) m.reasoning = true;
    if (newModel.contextWindow) m.contextWindow = Number(newModel.contextWindow);
    // 添加费用配置
    const cost: any = {};
    if (newModel.cost.input) cost.input = Number(newModel.cost.input);
    if (newModel.cost.output) cost.output = Number(newModel.cost.output);
    if (newModel.cost.cacheRead) cost.cacheRead = Number(newModel.cost.cacheRead);
    if (newModel.cost.cacheWrite) cost.cacheWrite = Number(newModel.cost.cacheWrite);
    if (Object.keys(cost).length > 0) m.cost = cost;
    setField(['models', 'providers', showAddModel, 'models'], [...models, m]);
    setNewModel({ id: '', name: '', reasoning: false, contextWindow: '', cost: { input: '', output: '', cacheRead: '', cacheWrite: '' } });
    setShowAddModel(null);
  }, [showAddModel, newModel, getField, setField]);

  // 向导步骤摘要
  const stepSummaries = useMemo(() => [
    preset ? `${preset.icon} ${selectedPresetDisplayName}` : '',
    wizApiKey ? `${es.lblApiKey} ✓` : preset?.id === 'ollama' ? es.localModels : '',
    wizModels.length > 0 ? `${wizModels[0]}${wizModels.length > 1 ? ` +${wizModels.length - 1}` : ''}` : '',
    wizModels.length > 1 ? `${wizModels.length} ${es.models}` : es.default,
  ], [preset, selectedPresetDisplayName, wizApiKey, wizModels, es]);

  useEffect(() => {
    if (wizardStep !== 2 || !selectedProvider) return;
    if ((preset?.models?.length || 0) > 0) return;
    if (discoveredModels.length > 0 || discoveringModels) return;
    if (autoDiscoverAttemptKey === autoDiscoverKey) return;
    setAutoDiscoverAttemptKey(autoDiscoverKey);
    discoverModelsForWizard();
  }, [wizardStep, selectedProvider, preset, discoveredModels.length, discoveringModels, discoverModelsForWizard, autoDiscoverAttemptKey, autoDiscoverKey]);

  return (
    <div className="space-y-4">
      {/* ================================================================ */}
      {/* 已配置的服务商列表 */}
      {/* ================================================================ */}
      <ConfigSection
        title={es.providers}
        icon="cloud"
        iconColor="text-blue-500"
        desc={`${providerEntries.length} ${es.providerCount}`}
      >
        {providerEntries.length === 0 ? (
          <EmptyState message={es.noProviders} icon="cloud_off" />
        ) : (
          providerEntries.map(([name, cfg]: [string, any]) => {
            const models: any[] = cfg.models || [];
            const testState = providerTestStatus[name] || 'idle';
            return (
              <ConfigCard
                key={name}
                title={name}
                icon="dns"
                onDelete={() => deleteField(['models', 'providers', name])}
                defaultOpen={false}
                actions={
                  <button
                    onClick={() => handleTestProvider(name, cfg)}
                    disabled={testState === 'testing'}
                    title={es.testConn}
                    className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${
                      testState === 'testing' ? 'text-slate-400 cursor-wait' :
                      testState === 'ok' ? 'text-green-500 hover:text-green-600' :
                      testState === 'warning' ? 'text-amber-500 hover:text-amber-600' :
                      testState === 'fail' ? 'text-red-500 hover:text-red-600' :
                      'text-slate-400 hover:text-primary hover:bg-primary/5'
                    }`}
                  >
                    <span className={`material-symbols-outlined text-[16px] ${
                      testState === 'testing' ? 'animate-spin' : ''
                    }`}>
                      {testState === 'testing' ? 'progress_activity' :
                       testState === 'ok' ? 'check_circle' :
                       testState === 'warning' ? 'warning' :
                       testState === 'fail' ? 'error' :
                       'play_arrow'}
                    </span>
                  </button>
                }
              >
                <TextField label={es.lblBaseUrl} value={cfg.baseUrl || ''} onChange={v => setField(['models', 'providers', name, 'baseUrl'], v)} placeholder={es.phOpenAIBaseUrl} tooltip={es.baseUrlTip} />
                <PasswordField label={es.lblApiKey} value={cfg.apiKey || ''} onChange={v => setField(['models', 'providers', name, 'apiKey'], v)} placeholder={es.phApiKeySk} tooltip={es.apiKeyTip} />
                <SelectField label={es.lblApi} value={cfg.api || 'openai-completions'} onChange={v => setField(['models', 'providers', name, 'api'], v)} options={API_OPTIONS} tooltip={es.apiTypeTip} />
                <SelectField label={es.authMethod} value={cfg.auth || 'api-key'} onChange={v => setField(['models', 'providers', name, 'auth'], v)} options={AUTH_OPTIONS} tooltip={es.authMethodTip} />
                <KeyValueField label={es.customHeaders || 'Custom Headers'} value={cfg.headers || {}} onChange={v => setField(['models', 'providers', name, 'headers'], v)} tooltip={es.tipCustomHeaders} keyPlaceholder="Header-Name" valuePlaceholder="value" />
                {/* 模型列表 */}
                <div className="mt-2 pt-2 border-t border-slate-100 dark:border-white/[0.04]">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold text-slate-500">{es.models} ({models.length})</span>
                    <button onClick={() => { setShowAddModel(name); setNewModel({ id: '', name: '', reasoning: false, contextWindow: '', cost: { input: '', output: '', cacheRead: '', cacheWrite: '' } }); setAddModelDiscovered([]); setAddModelDiscovering(false); setAddModelSearchOpen(false); setAddModelHighlight(-1); }} className="text-[11px] font-bold text-primary hover:underline">+ {es.add}</button>
                  </div>
                  {models.map((m: any, mi: number) => {
                    const path = `${name}/${m.id}`;
                    const isPrimary = primaryModel === path;
                    const isFallback = fallbacks.includes(path);
                    return (
                      <div key={mi} className={`flex items-center gap-2 px-2 py-1.5 rounded-md mb-1 ${isPrimary ? 'bg-primary/5 border border-primary/20' : 'bg-slate-50 dark:bg-white/[0.02]'}`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 truncate">{m.name || m.id}</span>
                            {m.reasoning && <span className="text-[10px] px-1 py-0.5 bg-purple-500/10 text-purple-500 rounded font-bold">R</span>}
                            {m.contextWindow && <span className="text-[10px] text-slate-400">{Math.round(m.contextWindow / 1000)}K</span>}
                          </div>
                          <span className="text-[11px] text-slate-400 font-mono">{m.id}</span>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button onClick={() => setPrimary(path)} title={es.setPrimary} aria-label={es.setPrimary} className={`w-6 h-6 flex items-center justify-center rounded ${isPrimary ? 'text-primary' : 'text-slate-400 hover:text-primary'}`}>
                            <span className="material-symbols-outlined text-[14px]">{isPrimary ? 'star' : 'star_outline'}</span>
                          </button>
                          <button onClick={() => toggleFallback(path)} title={es.fallback} aria-label={es.fallback} className={`w-6 h-6 flex items-center justify-center rounded text-[11px] font-bold ${isFallback ? 'text-amber-500' : 'text-slate-400 hover:text-amber-500'}`}>
                            FB
                          </button>
                          <button onClick={() => {
                            const newModels = models.filter((_: any, j: number) => j !== mi);
                            setField(['models', 'providers', name, 'models'], newModels);
                          }} title={es.removeModel} aria-label={es.removeModel} className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-red-500">
                            <span className="material-symbols-outlined text-[13px]">close</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ConfigCard>
            );
          })
        )}
      </ConfigSection>

      {/* ================================================================ */}
      {/* 添加服务商向导（Accordion Stepper） */}
      {/* ================================================================ */}
      {!wizardOpen ? (
        <button
          onClick={() => { resetWizard(); setWizardOpen(true); }}
          className="w-full py-3 border-2 border-dashed border-primary/30 hover:border-primary/60 rounded-xl text-xs font-bold text-primary hover:bg-primary/5 transition-all flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined text-sm">add_circle</span>
          {es.addProviderWizard}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-xs font-bold text-slate-700 dark:text-white/80 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm text-primary">auto_fix_high</span>
              {es.addProviderWizardTitle}
            </h3>
            <button onClick={() => { resetWizard(); setWizardOpen(false); }} className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-white/60">
              {es.cancel}
            </button>
          </div>

          {/* Step 1: 选择服务商 */}
          <AccordionStep stepNum={1} icon="dns" title={es.selectProvider} summary={stepSummaries[0]} open={wizardStep === 0} done={!!selectedProvider} onToggle={() => setWizardStep(0)}>
            <div className="space-y-3 pt-3">
              {(['builtin', 'custom', 'local'] as const).map(cat => {
                const items = providerCardsByCategory[cat];
                const label = cat === 'builtin' ? es.builtInProviders : cat === 'custom' ? es.thirdPartyCustom : es.localModels;
                return (
                  <div key={cat}>
                    <div className="text-[10px] font-medium text-slate-400 dark:text-white/40 mb-1.5">{label}</div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {items.map(p => (
                        <button key={p.id} onClick={() => handleSelectProvider(p.id)}
                          className={`p-2.5 rounded-lg border-2 transition-all text-start ${selectedProvider === p.id ? 'border-primary bg-primary/5 dark:bg-primary/10' : 'border-slate-200 dark:border-white/10 hover:border-primary/40'}`}>
                          <div className="min-w-0">
                            <span className="text-[11px] font-bold text-slate-700 dark:text-white/80 truncate block">{p.name}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </AccordionStep>

          {/* Step 2: 填写凭证 */}
          <AccordionStep stepNum={2} icon="key" title={es.credentials} summary={stepSummaries[1]} open={wizardStep === 1} done={wizardStep > 1} onToggle={() => selectedProvider && setWizardStep(1)}>
            {preset && (
              <div className="space-y-3 pt-3">
                {preset.id === 'custom' && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 mb-1 block">{es.providerName}</label>
                    <input type="text" value={wizCustomName}
                      onChange={e => setWizCustomName(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                      placeholder={es.providerNamePlaceholder}
                      className="w-full h-8 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md px-3 text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-primary" />
                    <span className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5 block">{es.providerNameHint}</span>
                  </div>
                )}
                {preset.id !== 'ollama' && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 mb-1 flex items-center gap-2">
                      {es.lblApiKey}
                      {preset.envVar && <span className="text-[11px] px-1.5 py-0.5 bg-slate-100 dark:bg-white/5 rounded font-mono">{preset.envVar}</span>}
                    </label>
                    <div className="relative mt-1">
                      <input type={wizShowKey ? 'text' : 'password'} value={wizApiKey} onChange={e => setWizApiKey(e.target.value)}
                        placeholder={es.phApiKeySk} className="w-full h-8 pe-8 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md px-3 text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-primary" />
                      <button onClick={() => setWizShowKey(!wizShowKey)} title={es.lblApiKey} aria-label={es.lblApiKey} className="absolute end-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                        <span className="material-symbols-outlined text-[14px]">{wizShowKey ? 'visibility_off' : 'visibility'}</span>
                      </button>
                    </div>
                    {preset.helpUrl && (
                      <a href={preset.helpUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary hover:underline mt-1 inline-flex items-center gap-0.5">
                        <span className="material-symbols-outlined text-[11px]">open_in_new</span>{preset.helpUrl}
                      </a>
                    )}
                  </div>
                )}
                {(preset.needsBaseUrl || preset.category === 'local' || preset.id === 'custom') && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 mb-1 block">{es.lblBaseUrl}</label>
                    <input type="text" value={wizBaseUrl} onChange={e => setWizBaseUrl(e.target.value)}
                      placeholder={preset.baseUrl || es.phOpenAIBaseUrl}
                      className="w-full h-8 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md px-3 text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-primary" />
                  </div>
                )}
                {preset.id === 'custom' && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 mb-1 block">{es.apiType}</label>
                    <div className="flex gap-1.5 flex-wrap">
                      {API_OPTIONS.slice(0, 3).map(o => (
                        <button key={o.value} onClick={() => setWizApiType(o.value)}
                          className={`px-2.5 py-1.5 rounded-lg text-[10px] font-medium border-2 transition-all ${wizApiType === o.value ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 dark:border-white/10 text-slate-500'}`}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex justify-end">
                  <button onClick={() => setWizardStep(2)} className="px-4 py-1.5 bg-primary text-white text-[11px] font-bold rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-1">
                    {es.next}<span className="material-symbols-outlined text-[14px]">chevron_right</span>
                  </button>
                </div>
              </div>
            )}
          </AccordionStep>

          {/* Step 3: 选择模型（多模型） */}
          <AccordionStep stepNum={3} icon="smart_toy" title={es.selectModel} summary={stepSummaries[2]} open={wizardStep === 2} done={wizardStep > 2} onToggle={() => selectedProvider && setWizardStep(2)}>
            {preset && (() => {
              const q = wizSearchInput.toLowerCase();
              const filtered = wizardModelCandidates.filter(m => !wizModels.includes(m.id) && (!q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)));
              const addModelToList = (id: string) => {
                if (id && !wizModels.includes(id)) {
                  setWizModels(prev => [...prev, id]);
                  // For custom providers, open cost editor immediately after adding.
                  if (selectedProvider === 'custom') {
                    setWizExpandedCost(id);
                  }
                }
                setWizSearchInput(''); setModelSearchOpen(false); setModelHighlight(-1);
              };
              return (
                <div className="space-y-3 pt-3" style={{ overflow: 'visible' }}>
                  {/* 搜索输入 + 添加按钮 */}
                  <div ref={modelSearchRef}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <label className="text-[10px] font-bold text-slate-500">{es.modelSearchPlaceholder}</label>
                      <button
                        onClick={discoverModelsForWizard}
                        disabled={discoveringModels}
                        className="h-6 px-2 rounded-md border border-slate-200 dark:border-white/10 text-[10px] font-bold text-slate-600 dark:text-slate-300 hover:text-primary hover:border-primary/40 disabled:opacity-40 inline-flex items-center gap-1"
                        title={es.discoverModels}
                      >
                        {discoveringModels
                          ? <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
                          : <span className="material-symbols-outlined text-[12px]">sync</span>}
                        {es.discoverModels}
                      </button>
                    </div>
                    <div className="flex gap-1.5">
                      <div className="relative flex-1">
                        <span className="material-symbols-outlined text-[14px] text-slate-400 absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none">search</span>
                        <input type="text" value={wizSearchInput}
                          onChange={e => { setWizSearchInput(e.target.value); setModelSearchOpen(true); setModelHighlight(-1); }}
                          onFocus={() => { setModelSearchOpen(true); setModelHighlight(-1); }}
                          onKeyDown={e => {
                            if (e.key === 'ArrowDown' && modelSearchOpen && filtered.length > 0) { e.preventDefault(); setModelHighlight(i => (i + 1) % filtered.length); }
                            else if (e.key === 'ArrowUp' && modelSearchOpen && filtered.length > 0) { e.preventDefault(); setModelHighlight(i => (i <= 0 ? filtered.length - 1 : i - 1)); }
                            else if (e.key === 'Enter') {
                              e.preventDefault();
                              if (modelHighlight >= 0 && modelHighlight < filtered.length) addModelToList(filtered[modelHighlight].id);
                              else if (wizSearchInput.trim()) addModelToList(wizSearchInput.trim());
                            } else if (e.key === 'Escape') { setModelSearchOpen(false); setModelHighlight(-1); }
                          }}
                          placeholder={es.modelSearchPlaceholder}
                          className="w-full h-8 ps-8 pe-3 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-primary" />
                      </div>
                      <button onClick={() => { if (wizSearchInput.trim()) addModelToList(wizSearchInput.trim()); }}
                        disabled={!wizSearchInput.trim() || wizModels.includes(wizSearchInput.trim())}
                        className="px-3 h-8 bg-primary text-white text-[10px] font-bold rounded-md hover:bg-primary/90 transition-colors disabled:opacity-30 shrink-0 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">add</span>{es.addToList}
                      </button>
                    </div>
                    {modelSearchOpen && filtered.length > 0 && (
                      <div ref={modelListRef} className="mt-1 max-h-52 overflow-y-auto custom-scrollbar rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#2a2a2e] shadow-xl" style={{ position: 'relative', zIndex: 50 }}>
                        {filtered.map((m, idx) => (
                          <button key={m.id}
                            onMouseEnter={() => setModelHighlight(idx)}
                            onClick={() => addModelToList(m.id)}
                            ref={el => { if (idx === modelHighlight && el) el.scrollIntoView({ block: 'nearest' }); }}
                            className={`w-full text-start px-3 py-2.5 flex items-center justify-between gap-2 transition-colors border-b border-slate-100 dark:border-white/[0.04] last:border-b-0 ${idx === modelHighlight ? 'bg-primary/10 dark:bg-primary/20' : 'hover:bg-slate-50 dark:hover:bg-white/[0.04]'}`}>
                            <div className="min-w-0">
                              <div className="text-[11px] font-bold text-slate-700 dark:text-white/80 truncate">{m.name}</div>
                              <div className="text-[11px] font-mono text-slate-400 truncate">{m.id}</div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {m.cost && <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded" title={`${es.inputCost}: $${m.cost.input}, ${es.outputCost}: $${m.cost.output}`}>${m.cost.input}/${m.cost.output}</span>}
                              {m.ctx && <span className="text-[11px] px-1.5 py-0.5 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded">{m.ctx}</span>}
                              <span className="material-symbols-outlined text-[14px] text-primary/60">add_circle</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* 已选模型列表 */}
                  {wizModels.length > 0 && (
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 mb-1 block">{es.modelList} ({wizModels.length})</label>
                      <div className="rounded-lg border border-slate-200 dark:border-white/10 divide-y divide-slate-100 dark:divide-white/[0.04]">
                        {wizModels.map((mid, idx) => {
                          const info = wizardModelCandidates.find(m => m.id === mid);
                          const customCost = wizModelCosts[mid] || { input: '', output: '', cacheRead: '', cacheWrite: '' };
                          const isExpanded = wizExpandedCost === mid;
                          const displayCost = customCost.input || customCost.output ? customCost : (info?.cost ? { input: String(info.cost.input), output: String(info.cost.output), cacheRead: String(info.cost.cacheRead || ''), cacheWrite: String(info.cost.cacheWrite || '') } : null);
                          return (
                            <div key={mid} className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded shrink-0 ${idx === 0 ? 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400' : 'bg-slate-100 dark:bg-white/[0.06] text-slate-500 dark:text-white/40'}`}>
                                  {idx === 0 ? es.primary : `${es.fallbackN} ${idx}`}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <span className="text-[11px] font-mono text-slate-700 dark:text-white/80 truncate block">{mid}</span>
                                  <div className="flex items-center gap-2">
                                    {info && info.name !== mid && <span className="text-[11px] text-slate-400 truncate">{info.name}{info.ctx ? ` · ${info.ctx}` : ''}</span>}
                                    {displayCost && <span className="text-[10px] text-amber-500">💰 ${displayCost.input || '0'}/${displayCost.output || '0'}</span>}
                                  </div>
                                </div>
                                <div className="flex items-center gap-0.5 shrink-0">
                                  <button onClick={() => setWizExpandedCost(isExpanded ? null : mid)}
                                    aria-label={es.modelCost}
                                    className={`p-0.5 transition-colors ${isExpanded ? 'text-amber-500' : 'text-slate-300 hover:text-amber-500 dark:text-white/20 dark:hover:text-amber-400'}`} title={es.modelCost}>
                                    <span className="material-symbols-outlined text-[14px]">payments</span>
                                  </button>
                                  {idx > 0 && (
                                    <button onClick={() => setWizModels(prev => { const n = [...prev];[n[idx - 1], n[idx]] = [n[idx], n[idx - 1]]; return n; })}
                                      aria-label={es.moveUp}
                                      className="p-0.5 text-slate-300 hover:text-slate-500 dark:text-white/20 dark:hover:text-white/50" title={es.moveUp}>
                                      <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
                                    </button>
                                  )}
                                  <button onClick={() => setWizModels(prev => prev.filter((_, i) => i !== idx))}
                                    aria-label={es.removeModel}
                                    className="p-0.5 text-slate-300 hover:text-red-500 dark:text-white/20 dark:hover:text-red-400" title={es.removeModel}>
                                    <span className="material-symbols-outlined text-[14px]">close</span>
                                  </button>
                                </div>
                              </div>
                              {/* 费用编辑面板 */}
                              {isExpanded && (
                                <div className="mt-2 pt-2 border-t border-slate-100 dark:border-white/[0.04]">
                                  <div className="flex items-center gap-1.5 mb-2">
                                    <span className="material-symbols-outlined text-[12px] text-amber-500">payments</span>
                                    <span className="text-[10px] font-bold text-slate-500">{es.modelCost}</span>
                                    <span className="text-[10px] text-slate-400">({es.perMillionTokens})</span>
                                  </div>
                                  <div className="grid grid-cols-4 gap-2">
                                    <div>
                                      <label className="text-[9px] text-slate-400 mb-0.5 block">{es.inputCost}</label>
                                      <NumberStepper
                                        step={0.01}
                                        min={0}
                                        value={customCost.input}
                                        placeholder={info?.cost?.input?.toString() || '0'}
                                        onChange={v => setWizModelCosts(prev => ({ ...prev, [mid]: { ...customCost, input: v } }))}
                                        className="w-full h-6"
                                        inputClassName="font-mono text-[10px]"
                                      />
                                    </div>
                                    <div>
                                      <label className="text-[9px] text-slate-400 mb-0.5 block">{es.outputCost}</label>
                                      <NumberStepper
                                        step={0.01}
                                        min={0}
                                        value={customCost.output}
                                        placeholder={info?.cost?.output?.toString() || '0'}
                                        onChange={v => setWizModelCosts(prev => ({ ...prev, [mid]: { ...customCost, output: v } }))}
                                        className="w-full h-6"
                                        inputClassName="font-mono text-[10px]"
                                      />
                                    </div>
                                    <div>
                                      <label className="text-[9px] text-slate-400 mb-0.5 block">{es.cacheReadCost}</label>
                                      <NumberStepper
                                        step={0.01}
                                        min={0}
                                        value={customCost.cacheRead}
                                        placeholder={info?.cost?.cacheRead?.toString() || '0'}
                                        onChange={v => setWizModelCosts(prev => ({ ...prev, [mid]: { ...customCost, cacheRead: v } }))}
                                        className="w-full h-6"
                                        inputClassName="font-mono text-[10px]"
                                      />
                                    </div>
                                    <div>
                                      <label className="text-[9px] text-slate-400 mb-0.5 block">{es.cacheWriteCost}</label>
                                      <NumberStepper
                                        step={0.01}
                                        min={0}
                                        value={customCost.cacheWrite}
                                        placeholder={info?.cost?.cacheWrite?.toString() || '0'}
                                        onChange={v => setWizModelCosts(prev => ({ ...prev, [mid]: { ...customCost, cacheWrite: v } }))}
                                        className="w-full h-6"
                                        inputClassName="font-mono text-[10px]"
                                      />
                                    </div>
                                  </div>
                                  <p className="text-[9px] text-slate-400 mt-1">{es.costHint}</p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">{es.fallbackModelDesc}</p>
                    </div>
                  )}
                  <div className="flex justify-end">
                    <button onClick={() => setWizardStep(3)} disabled={wizModels.length === 0}
                      className="px-4 py-1.5 bg-primary text-white text-[11px] font-bold rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-1 disabled:opacity-50">
                      {es.next}<span className="material-symbols-outlined text-[14px]">chevron_right</span>
                    </button>
                  </div>
                </div>
              );
            })()}
          </AccordionStep>

          {/* Step 4: 高级设置 + 确认 */}
          <AccordionStep stepNum={4} icon="tune" title={es.confirmConfig} summary={stepSummaries[3]} open={wizardStep === 3} done={false} onToggle={() => wizFinalModel && setWizardStep(3)}>
            {preset && (
              <div className="space-y-3 pt-3">
                {preset.id !== 'custom' && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 mb-1 block">{es.apiType}</label>
                    <div className="flex gap-1.5 flex-wrap">
                      {API_OPTIONS.slice(0, 3).map(o => (
                        <button key={o.value} onClick={() => setWizApiType(o.value)}
                          className={`px-2.5 py-1.5 rounded-lg text-[10px] font-medium border-2 transition-all ${wizApiType === o.value ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 dark:border-white/10 text-slate-500'}`}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {!preset.needsBaseUrl && preset.category !== 'local' && preset.id !== 'custom' && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 mb-1 block">{es.baseUrlOptional}</label>
                    <input type="text" value={wizBaseUrl} onChange={e => setWizBaseUrl(e.target.value)} placeholder={selectedProviderDefaults.baseUrl}
                      className="w-full h-8 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md px-3 text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-primary" />
                  </div>
                )}
                {/* 配置预览 */}
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/[0.06]">
                  <div className="text-[10px] font-bold text-slate-500 mb-1.5">{es.configSummary}</div>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div><span className="text-slate-400">{es.provider}:</span> <span className="font-bold text-slate-700 dark:text-white/80">{preset.icon} {selectedPresetDisplayName}</span></div>
                    <div><span className="text-slate-400">{es.lblApi}:</span> <span className="font-bold text-slate-700 dark:text-white/80">{wizApiType}</span></div>
                    <div><span className="text-slate-400">{es.lblApiKey}:</span> <span className="font-bold text-slate-700 dark:text-white/80">{wizApiKey ? '✓' : '—'}</span></div>
                    <div><span className="text-slate-400">{es.models}:</span> <span className="font-bold text-slate-700 dark:text-white/80">{wizModels.length}</span></div>
                  </div>
                  {wizModels.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-white/[0.06] space-y-0.5">
                      {wizModels.map((mid, idx) => (
                        <div key={mid} className="text-[10px] font-mono text-slate-600 dark:text-white/60">
                          <span className={`inline-block w-14 text-[11px] font-bold ${idx === 0 ? 'text-green-600 dark:text-green-400' : 'text-slate-400'}`}>
                            {idx === 0 ? es.primary : `${es.fallbackN} ${idx}`}
                          </span>
                          {mid}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={handleTestConnection} disabled={testStatus === 'testing'}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 transition-all disabled:opacity-50">
                  <span className={`material-symbols-outlined text-[14px] ${testStatus === 'testing' ? 'animate-spin' : ''} ${testStatus === 'ok' ? 'text-green-500' : testStatus === 'fail' ? 'text-red-500' : ''}`}>
                    {testStatus === 'testing' ? 'progress_activity' : testStatus === 'ok' ? 'check_circle' : testStatus === 'fail' ? 'error' : 'wifi_tethering'}
                  </span>
                  {testStatus === 'testing' ? es.testing : testStatus === 'ok' ? es.connected : testStatus === 'fail' ? es.failed : es.testConn}
                </button>
                <div className="flex justify-end gap-2">
                  <button onClick={() => { resetWizard(); setWizardOpen(false); }} className="px-4 py-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-700 dark:hover:text-white/60">
                    {es.cancel}
                  </button>
                  <button onClick={handleWizardSave} disabled={wizModels.length === 0}
                    className="px-5 py-1.5 bg-green-500 hover:bg-green-600 text-white text-[11px] font-bold rounded-lg transition-colors flex items-center gap-1 disabled:opacity-50">
                    <span className="material-symbols-outlined text-[14px]">check</span>
                    {es.saveApply}
                  </button>
                </div>
              </div>
            )}
          </AccordionStep>
        </div>
      )}

      {/* ================================================================ */}
      {/* 模型选择（主模型/备用模型） */}
      {/* ================================================================ */}
      <ConfigSection title={es.models} icon="star" iconColor="text-amber-500">
        {(() => {
          const globalModels = [primaryModel, ...fallbacks].filter(Boolean);
          const addGlobalModel = (path: string) => {
            if (!path || globalModels.includes(path)) return;
            if (!primaryModel) { setPrimary(path); }
            else { setField(['agents', 'defaults', 'model', 'fallbacks'], [...fallbacks, path]); }
          };
          const removeGlobalModel = (idx: number) => {
            if (idx === 0) {
              setPrimary(fallbacks[0] || '');
              setField(['agents', 'defaults', 'model', 'fallbacks'], fallbacks.slice(1));
            } else {
              const n = [...fallbacks]; n.splice(idx - 1, 1);
              setField(['agents', 'defaults', 'model', 'fallbacks'], n);
            }
          };
          const moveGlobalModelUp = (idx: number) => {
            if (idx <= 0) return;
            const all = [...globalModels];
            [all[idx - 1], all[idx]] = [all[idx], all[idx - 1]];
            setPrimary(all[0]);
            setField(['agents', 'defaults', 'model', 'fallbacks'], all.slice(1));
          };
          return (
            <div className="space-y-3 pt-1" style={{ overflow: 'visible' }}>
              <ModelPathSearch
                value=""
                onChange={addGlobalModel}
                options={allModelPaths}
                placeholder={es.modelSearchPlaceholder}
                exclude={globalModels}
                clearOnSelect
              />
              {globalModels.length > 0 && (
                <div>
                  <label className="text-[10px] font-bold text-slate-500 mb-1 block">{es.modelList} ({globalModels.length})</label>
                  <div className="rounded-lg border border-slate-200 dark:border-white/10 divide-y divide-slate-100 dark:divide-white/[0.04]">
                    {globalModels.map((path, idx) => {
                      const info = allModelPaths.find(o => o.path === path);
                      return (
                        <div key={path} className="flex items-center gap-2 px-3 py-2">
                          <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded shrink-0 ${idx === 0 ? 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400' : 'bg-slate-100 dark:bg-white/[0.06] text-slate-500 dark:text-white/40'}`}>
                            {idx === 0 ? es.primary : `${es.fallbackN} ${idx}`}
                          </span>
                          <div className="flex-1 min-w-0">
                            <span className="text-[11px] font-mono text-slate-700 dark:text-white/80 truncate block">{path}</span>
                            {info && info.name && info.name !== info.model && <span className="text-[11px] text-slate-400 truncate block">{info.name}</span>}
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            {idx > 0 && (
                              <button onClick={() => moveGlobalModelUp(idx)}
                                aria-label={es.moveUp}
                                className="p-0.5 text-slate-300 hover:text-slate-500 dark:text-white/20 dark:hover:text-white/50" title={es.moveUp}>
                                <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
                              </button>
                            )}
                            <button onClick={() => removeGlobalModel(idx)}
                              aria-label={es.removeModel}
                              className="p-0.5 text-slate-300 hover:text-red-500 dark:text-white/20 dark:hover:text-red-400" title={es.removeModel}>
                              <span className="material-symbols-outlined text-[14px]">close</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">{es.fallbackModelDesc}</p>
                </div>
              )}
              {/* 子代理模型 */}
              <div className="space-y-1 pt-1 border-t border-slate-100 dark:border-white/[0.04]">
                <div className="flex items-start gap-1.5">
                  <label className="text-[10px] font-bold text-slate-500 whitespace-nowrap shrink-0">{es.subagentModel}</label>
                  {es.subagentModelDesc && <span className="text-[11px] text-slate-400 leading-4 min-w-0">— {es.subagentModelDesc}</span>}
                </div>
                <ModelPathSearch
                  value={getField(['agents', 'defaults', 'subagents', 'model']) || ''}
                  onChange={v => setField(['agents', 'defaults', 'subagents', 'model'], v)}
                  options={allModelPaths}
                  placeholder={es.phProviderModelId}
                />
              </div>

              {/* 心跳模型 */}
              <div className="space-y-1 pt-1 border-t border-slate-100 dark:border-white/[0.04]">
                <div className="flex items-start gap-1.5">
                  <label className="text-[10px] font-bold text-slate-500 whitespace-nowrap shrink-0">{es.heartbeatModel}</label>
                  {es.heartbeatModelDesc && <span className="text-[11px] text-slate-400 leading-4 min-w-0">— {es.heartbeatModelDesc}</span>}
                </div>
                <ModelPathSearch
                  value={getField(['agents', 'defaults', 'heartbeat', 'model']) || ''}
                  onChange={v => setField(['agents', 'defaults', 'heartbeat', 'model'], v)}
                  options={allModelPaths}
                  placeholder={es.phProviderModelId}
                />
              </div>
            </div>
          );
        })()}
      </ConfigSection>

      {/* 模型设置 */}
      <ConfigSection title={es.advancedSettings} icon="settings" iconColor="text-blue-500" defaultOpen={false}>
        <SelectField
          label={es.mergeMode}
          desc={es.mergeModeDesc}
          value={getField(['models', 'mode']) || 'merge'}
          onChange={v => setField(['models', 'mode'], v)}
          options={[{ value: 'merge', label: es.optMerge }, { value: 'replace', label: es.optReplace }]}
          tooltip={es.mergeModeDesc}
        />
      </ConfigSection>

      {/* 添加模型弹窗 */}
      {showAddModel && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowAddModel(null)}>
          <div className="bg-white dark:bg-[#1e2028] rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-slate-800 dark:text-white">{es.add} {es.model} → {showAddModel}</h3>
            <div className="space-y-3">
              <div ref={addModelSearchRef}>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-bold text-slate-500">{es.modelIdRequired}</label>
                  <button
                    onClick={() => showAddModel && discoverModelsForProvider(showAddModel)}
                    disabled={addModelDiscovering}
                    className="h-6 px-2 rounded-md border border-slate-200 dark:border-white/10 text-[10px] font-bold text-slate-600 dark:text-slate-300 hover:text-primary hover:border-primary/40 disabled:opacity-40 inline-flex items-center gap-1"
                    title={es.discoverModels}
                  >
                    {addModelDiscovering
                      ? <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
                      : <span className="material-symbols-outlined text-[12px]">sync</span>}
                    {es.discoverModels}
                  </button>
                </div>
                <div className="relative">
                  <span className="material-symbols-outlined text-[14px] text-slate-400 absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none">search</span>
                  <input value={newModel.id}
                    onChange={e => { setNewModel({ ...newModel, id: e.target.value }); if (addModelDiscovered.length > 0) { setAddModelSearchOpen(true); setAddModelHighlight(-1); } }}
                    onFocus={() => { if (addModelDiscovered.length > 0) { setAddModelSearchOpen(true); setAddModelHighlight(-1); } }}
                    onKeyDown={e => {
                      if (addModelSearchOpen && addModelDiscovered.length > 0) {
                        const q = newModel.id.toLowerCase();
                        const filtered = addModelDiscovered.filter(m => !q || m.id.toLowerCase().includes(q) || (m.name && m.name.toLowerCase().includes(q)));
                        if (e.key === 'ArrowDown') { e.preventDefault(); setAddModelHighlight(i => (i + 1) % filtered.length); }
                        else if (e.key === 'ArrowUp') { e.preventDefault(); setAddModelHighlight(i => (i <= 0 ? filtered.length - 1 : i - 1)); }
                        else if (e.key === 'Enter' && addModelHighlight >= 0 && addModelHighlight < filtered.length) {
                          e.preventDefault();
                          setNewModel({ ...newModel, id: filtered[addModelHighlight].id, name: filtered[addModelHighlight].name || '' });
                          setAddModelSearchOpen(false); setAddModelHighlight(-1);
                          return;
                        } else if (e.key === 'Escape') { setAddModelSearchOpen(false); setAddModelHighlight(-1); return; }
                      }
                      if (e.key === 'Enter') addModel();
                    }}
                    placeholder={es.phProviderModelId}
                    className="w-full h-8 ps-8 pe-3 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-primary" />
                </div>
                {addModelSearchOpen && addModelDiscovered.length > 0 && (() => {
                  const q = newModel.id.toLowerCase();
                  const existingModels = (getField(['models', 'providers', showAddModel!, 'models']) as any[] || []).map((m: any) => typeof m === 'string' ? m : m?.id);
                  const filtered = addModelDiscovered.filter(m =>
                    (!q || m.id.toLowerCase().includes(q) || (m.name && m.name.toLowerCase().includes(q))) &&
                    !existingModels.includes(m.id)
                  );
                  return filtered.length > 0 ? (
                    <div className="mt-1 max-h-48 overflow-y-auto custom-scrollbar rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#2a2a2e] shadow-xl z-50 relative">
                      {filtered.map((m, idx) => (
                        <button key={m.id}
                          onMouseEnter={() => setAddModelHighlight(idx)}
                          onClick={() => {
                            setNewModel({ ...newModel, id: m.id, name: m.name || '' });
                            setAddModelSearchOpen(false); setAddModelHighlight(-1);
                          }}
                          ref={el => { if (idx === addModelHighlight && el) el.scrollIntoView({ block: 'nearest' }); }}
                          className={`w-full text-start px-3 py-2 flex items-center gap-2 transition-colors border-b border-slate-100 dark:border-white/[0.04] last:border-b-0 ${idx === addModelHighlight ? 'bg-primary/10 dark:bg-primary/20' : 'hover:bg-slate-50 dark:hover:bg-white/[0.04]'}`}>
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] font-mono font-bold text-slate-700 dark:text-white/80 truncate">{m.id}</div>
                            {m.name && m.name !== m.id && <div className="text-[11px] text-slate-400 truncate">{m.name}</div>}
                          </div>
                          <span className="material-symbols-outlined text-[14px] text-primary/60 shrink-0">add_circle</span>
                        </button>
                      ))}
                    </div>
                  ) : null;
                })()}
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 mb-1 block">{es.name}</label>
                <input value={newModel.name} onChange={e => setNewModel({ ...newModel, name: e.target.value })} placeholder={es.phModelName} className="w-full h-8 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md px-3 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-primary" />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="text-[10px] font-bold text-slate-500 mb-1 block">{es.contextWindow}</label>
                  <NumberStepper
                    min={1}
                    step={1}
                    value={newModel.contextWindow}
                    onChange={v => setNewModel({ ...newModel, contextWindow: v })}
                    placeholder={es.phContextWindow}
                    className="w-full h-8"
                    inputClassName="font-mono text-xs"
                  />
                  <p className="text-[11px] text-slate-400 mt-0.5">{es.contextWindowDesc}</p>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 mb-1 block">{es.reasoning}</label>
                  <button onClick={() => setNewModel({ ...newModel, reasoning: !newModel.reasoning })} className={`w-9 h-5 rounded-full relative transition-colors mt-1.5 ${newModel.reasoning ? 'bg-primary' : 'bg-slate-300 dark:bg-slate-600'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${newModel.reasoning ? 'translate-x-[18px] rtl:-translate-x-[18px]' : 'translate-x-0.5 rtl:-translate-x-0.5'}`} />
                  </button>
                  <p className="text-[11px] text-slate-400 mt-0.5">{es.reasoningDesc}</p>
                </div>
              </div>
              {/* 费用配置 */}
              <div className="pt-2 border-t border-slate-100 dark:border-white/[0.06]">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="material-symbols-outlined text-[14px] text-amber-500">payments</span>
                  <label className="text-[10px] font-bold text-slate-500">{es.modelCost}</label>
                  <span className="text-[10px] text-slate-400">({es.perMillionTokens})</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-400 mb-0.5 block">{es.inputCost}</label>
                    <NumberStepper
                      step={0.01}
                      min={0}
                      value={newModel.cost.input}
                      onChange={v => setNewModel({ ...newModel, cost: { ...newModel.cost, input: v } })}
                      placeholder={es.phInputCost}
                      className="w-full h-7"
                      inputClassName="font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 mb-0.5 block">{es.outputCost}</label>
                    <NumberStepper
                      step={0.01}
                      min={0}
                      value={newModel.cost.output}
                      onChange={v => setNewModel({ ...newModel, cost: { ...newModel.cost, output: v } })}
                      placeholder={es.phOutputCost}
                      className="w-full h-7"
                      inputClassName="font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 mb-0.5 block">{es.cacheReadCost}</label>
                    <NumberStepper
                      step={0.01}
                      min={0}
                      value={newModel.cost.cacheRead}
                      onChange={v => setNewModel({ ...newModel, cost: { ...newModel.cost, cacheRead: v } })}
                      placeholder={es.phCacheReadCost}
                      className="w-full h-7"
                      inputClassName="font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 mb-0.5 block">{es.cacheWriteCost}</label>
                    <NumberStepper
                      step={0.01}
                      min={0}
                      value={newModel.cost.cacheWrite}
                      onChange={v => setNewModel({ ...newModel, cost: { ...newModel.cost, cacheWrite: v } })}
                      placeholder={es.phCacheWriteCost}
                      className="w-full h-7"
                      inputClassName="font-mono text-xs"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">{es.costHint}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowAddModel(null)} className="px-4 h-8 text-[11px] font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">{es.cancel}</button>
              <button onClick={addModel} className="px-4 h-8 bg-primary text-white text-[11px] font-bold rounded-lg">{es.add}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
