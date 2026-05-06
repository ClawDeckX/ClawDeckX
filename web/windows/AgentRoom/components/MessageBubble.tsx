// MessageBubble —— 8 种消息态
// 普通 chat / 思考 thinking / 工具 tool / 工具审批 tool_approval / 私聊 whisper
// 错误 error / 竞价 bidding / 投影入站 projection_in
// 额外：扮演 impersonating（通过 actingAsId 字段识别）
import React, { useMemo, useState } from 'react';
import type { Member, Message } from '../types';
import type { SystemModel } from '../service';
import { MemberAvatar, ThinkingDots, formatTime } from '../shared';
import MarkdownView from './MarkdownView';
import { usePromptDialog } from '../../../components/PromptDialog';
import { useConfirm } from '../../../components/ConfirmDialog';
import { useToast } from '../../../components/Toast';
import CustomSelect from '../../../components/CustomSelect';
import { stripSilentSentinel } from '../../../utils/content-blocks';

// v0.9.1 新增：一键复制消息到剪贴板。
// 复用浏览器 Clipboard API；老环境退化到 document.execCommand('copy')（WebView 里的兼容路径）。
// 成功/失败均通过 useToast 给出即时反馈，避免用户点完没有任何迹象以为没生效。
async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// LongTextCollapse —— 长文本折叠。超过 `limit` 字符自动截断 + "展开" 按钮。
const LongTextCollapse: React.FC<{ children: string; limit?: number; render: (s: string) => React.ReactNode }> = ({ children, limit = 600, render }) => {
  const [expanded, setExpanded] = useState(false);
  if (children.length <= limit || expanded) {
    return (
      <>
        {render(children)}
        {children.length > limit && (
          <button
            onClick={() => setExpanded(false)}
            className="mt-1 text-[11px] text-cyan-500 hover:underline"
          >收起</button>
        )}
      </>
    );
  }
  return (
    <>
      {render(children.slice(0, limit) + '…')}
      <button
        onClick={() => setExpanded(true)}
        className="mt-1 text-[11px] text-cyan-500 hover:underline"
      >展开 ({children.length} 字)</button>
    </>
  );
};

// ── 工具调用的一些小工具 ──
//
// v0.9：默认把 tool bubble 压成一行，避免 exec/write/process 多条连环调用
// 把中间消息窗充满。除了折叠，额外做"乱码检测"：
// 后端子进程在 Windows cp936 环境下输出的 UTF-8 常被二次解码成 "����" 填充整屏，
// 全部原样贴到 UI 既丑又无信息量。命中阈值时默认隐藏内容并提示。

const GARBLED_CHARS = /[\uFFFD\uFFFF�]/g;
function detectGarbled(s: string): { ratio: number; looksBinary: boolean } {
  if (!s) return { ratio: 0, looksBinary: false };
  const matches = s.match(GARBLED_CHARS);
  const ratio = matches ? matches.length / s.length : 0;
  // 另一种常见异常：几乎没有 ASCII 可打印字符（纯乱码二进制）
  const printable = s.match(/[\x20-\x7E\u4E00-\u9FFF]/g);
  const printableRatio = printable ? printable.length / s.length : 0;
  return { ratio, looksBinary: ratio > 0.1 || printableRatio < 0.4 };
}

// 用本地缓存记忆每条工具消息的展开态。切视图不掉。
// 不持久化到 localStorage——重开房间希望默认全部折叠，避免历史里曾展开的长输出再次喷满。
const toolExpandState = new Map<string, boolean>();

interface ToolCallCardProps {
  message: Message;
  author: Member | undefined;
  onApproveTool?: () => void;
  onRejectTool?: () => void;
}

const ToolCallCard: React.FC<ToolCallCardProps> = React.memo(({ message, author, onApproveTool, onRejectTool }) => {
  const [expanded, setExpanded] = useState<boolean>(() => toolExpandState.get(message.id) ?? false);
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    toolExpandState.set(message.id, next);
  };

  const status = message.toolStatus;
  const running = status === 'running' || status === 'pending';
  const ok = status === 'success';
  const fail = status === 'failure' || status === 'timeout' || status === 'rejected';
  const awaiting = status === 'pending';

  const icon = running ? 'progress_activity' : ok ? 'check_circle' : fail ? 'error' : 'build';
  const tone = ok
    ? 'border-green-500/25 bg-green-500/[0.04]'
    : fail
    ? 'border-red-500/25 bg-red-500/[0.04]'
    : 'border-cyan-500/25 bg-cyan-500/[0.03]';
  const iconColor = ok ? 'text-green-500' : fail ? 'text-red-500' : 'text-cyan-500';

  // 预览：取 result 首行（去掉开头空白），兜底用 args 摘要。
  const result = message.toolResult || '';
  const garbled = detectGarbled(result);
  const firstLine = result.split(/\r?\n/).find(l => l.trim().length > 0)?.trim() ?? '';
  const previewText = garbled.looksBinary
    ? '⚠ 输出包含乱码或二进制（常见于 Windows cp936 子进程），展开查看原文'
    : firstLine.length > 140
    ? firstLine.slice(0, 140) + '…'
    : firstLine;

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    try { navigator.clipboard?.writeText(result); } catch { /* noop */ }
  };

  return (
    <div className={`group/tool flex gap-2 py-0.5 px-3`}>
      {author && <MemberAvatar member={author} size="xs" />}
      <div className="flex-1 min-w-0">
        <div
          className={`rounded-lg border ${tone} transition-all overflow-hidden`}
        >
          {/* 头部：始终单行。整行可点切换展开。 */}
          <button
            type="button"
            onClick={toggle}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-start hover:bg-surface-sunken/40 transition-colors"
            aria-expanded={expanded}
          >
            <span className={`material-symbols-outlined text-[15px] shrink-0 ${iconColor} ${running ? 'animate-spin' : ''}`}>{icon}</span>
            <span className="font-mono text-[11.5px] font-semibold text-text shrink-0">{message.toolName || 'tool'}</span>
            {author && (
              <span className="text-[10.5px] text-text-muted shrink-0">· {author.name}</span>
            )}
            <span className="text-[10px] text-text-muted opacity-50 font-mono shrink-0">{formatTime(message.timestamp)}</span>
            {/* 预览：省略号单行，展开后隐藏 */}
            {!expanded && previewText && (
              <span className={`flex-1 min-w-0 truncate text-[11px] ${garbled.looksBinary ? 'text-amber-600 dark:text-amber-400' : 'text-text-secondary'} font-mono`}>
                {previewText}
              </span>
            )}
            {!expanded && !previewText && running && (
              <span className="flex-1 min-w-0 text-[11px] text-text-muted animate-pulse">运行中…</span>
            )}
            <span className={`material-symbols-outlined text-[16px] text-text-muted shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}>expand_more</span>
          </button>

          {expanded && (
            <div className="px-2.5 pb-2 pt-0.5 space-y-1.5 border-t border-border/60">
              {message.toolArgs && Object.keys(message.toolArgs).length > 0 && (
                <div className="text-[11px] font-mono">
                  <div className="text-[10px] text-text-muted uppercase tracking-wider mb-0.5">args</div>
                  <div className="rounded-md bg-surface-sunken/60 px-2 py-1 space-y-0.5">
                    {Object.entries(message.toolArgs).map(([k, v]) => (
                      <div key={k} className="break-all">
                        <span className="text-text-muted">{k}:</span>{' '}
                        <span className="text-text">{typeof v === 'string' ? v : JSON.stringify(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {result && (
                <div className="text-[11px] font-mono">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[10px] text-text-muted uppercase tracking-wider">
                      result {garbled.looksBinary && '· ⚠ 乱码/二进制'}
                    </span>
                    <button
                      onClick={copy}
                      className="text-[10px] text-cyan-500 hover:underline"
                      title="复制原文"
                    >复制</button>
                  </div>
                  <div className="rounded-md bg-surface-sunken/60 px-2 py-1 max-h-64 overflow-auto neon-scrollbar">
                    <LongTextCollapse limit={1200} render={(s) => (
                      <pre className="whitespace-pre-wrap break-all text-text leading-snug">{s}</pre>
                    )}>{result}</LongTextCollapse>
                  </div>
                </div>
              )}
              {awaiting && (onApproveTool || onRejectTool) && (
                <div className="flex gap-1.5 pt-1">
                  <button onClick={onApproveTool} className="px-2.5 h-6 rounded-md text-[11px] font-bold bg-green-500 text-white hover:bg-green-600">批准</button>
                  <button onClick={onRejectTool} className="px-2.5 h-6 rounded-md text-[11px] font-bold bg-surface hover:bg-surface-raised border border-border">拒绝</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

interface Props {
  message: Message;
  author: Member | undefined;             // 消息真正作者（扮演时为被扮演者）
  actingActor?: Member | undefined;       // 实际操作者（扮演时为人类）
  members: Map<string, Member>;
  isMe?: boolean;
  onEdit?: (newContent: string) => void;
  onDelete?: () => void;
  onFork?: () => void;
  onReact?: (emoji: string) => void;
  onApproveTool?: () => void;
  onRejectTool?: () => void;
  onReply?: () => void;
  onWhisper?: () => void;
  referencedMessage?: Message;
  // v0.6
  onPromoteDecision?: (summary?: string) => void;
  onDemoteDecision?: () => void;
  /** 换模型重跑：model 为 undefined 走后端默认（成员当前模型）；非空则覆盖。 */
  onRerun?: (model?: string) => void;
  /** 供换模型重跑选择器使用；空/undefined 时只给"原模型"选项。 */
  systemModels?: SystemModel[];
}

const DEFAULT_REACTIONS = ['👍', '❤️', '🔥', '🤔', '😂', '💡'];

// ── 系统消息行：短消息 inline 显示，长消息可折叠 ──
const SystemMessageLine: React.FC<{
  content: string; isLong: boolean; icon: string; timestamp: number;
}> = ({ content, isLong, icon, timestamp }) => {
  const [expanded, setExpanded] = React.useState(false);
  const preview = isLong && !expanded ? content.slice(0, 50) + '…' : content;
  return (
    <div className="py-2 mx-3 text-[11px] text-text-muted">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-px bg-border" />
        <span className="material-symbols-outlined text-[14px] text-cyan-500/60">{icon}</span>
        <span className={isLong ? 'cursor-pointer hover:text-text-secondary transition-colors' : ''} onClick={isLong ? () => setExpanded(e => !e) : undefined}>
          {preview}
        </span>
        {isLong && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="shrink-0 p-0 text-cyan-500/60 hover:text-cyan-500 transition-colors"
            title={expanded ? '折叠' : '展开'}
          >
            <span className="material-symbols-outlined text-[14px]">{expanded ? 'expand_less' : 'expand_more'}</span>
          </button>
        )}
        <span className="opacity-60 font-mono shrink-0">{formatTime(timestamp)}</span>
        <div className="flex-1 h-px bg-border" />
      </div>
    </div>
  );
};

const MessageBubbleInner: React.FC<Props> = ({
  message, author, actingActor, members, isMe,
  onEdit, onDelete, onFork, onReact, onApproveTool, onRejectTool, onReply, onWhisper,
  referencedMessage,
  onPromoteDecision, onDemoteDecision, onRerun, systemModels,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [showReactions, setShowReactions] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // 换模型重跑 · 弹窗所选模型（空串=原模型/继承默认）。null 表示弹窗未打开。
  const [rerunModel, setRerunModel] = useState<string | null>(null);
  const { prompt: promptDialog } = usePromptDialog();
  const { confirm } = useConfirm();
  const { toast } = useToast();

  // v0.9.1 复制消息原文到剪贴板。优先复制 message.content；成功/失败都给 toast 反馈。
  // 没对 Markdown 做反渲染——用户一般预期复制到的是"他们肉眼看到的原文"，
  // 而 agent 消息的 Markdown 源本身就是可读文本，粘贴到 IDE / 飞书 / 微信 都能接受。
  const handleCopyContent = async () => {
    const ok = await copyTextToClipboard(message.content || '');
    toast(ok ? 'success' : 'error', ok ? '已复制消息原文' : '复制失败 · 请手动选中文本复制');
  };

  // 模型选项：把"保持原模型"作为默认置顶；再追加系统已配置的模型列表。
  // 没有 systemModels 注入（例如孤立单测）时退化为只有"原模型"可选。
  const rerunOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [{
      value: '',
      label: message.model ? `保持原模型（${message.model}）` : '保持原模型',
    }];
    for (const m of systemModels || []) {
      if (!m.id) continue;
      opts.push({ value: m.id, label: m.label || m.id });
    }
    return opts;
  }, [systemModels, message.model]);

  const effectiveAuthor = author;
  const whisper = message.kind === 'whisper';
  const projectionIn = message.kind === 'projection_in';
  const impersonated = !!message.actingAsId && !!actingActor;

  if (message.deleted) {
    return (
      <div className="group flex gap-2.5 py-1.5 px-3 opacity-40 italic text-text-muted text-[12px]">
        <span className="material-symbols-outlined text-[14px]">block</span>
        消息已删除
      </div>
    );
  }

  // ── 竞价特殊态 ──
  if (message.kind === 'bidding') {
    return (
      <div className="my-2 mx-3 p-4 rounded-xl border border-amber-400/40 dark:border-amber-400/30 bg-gradient-to-br from-amber-500/5 to-orange-500/5 animate-card-enter">
        <div className="flex items-center gap-2 mb-3 text-amber-600 dark:text-amber-400">
          <span className="material-symbols-outlined text-[18px]">gavel</span>
          <span className="text-[12px] font-bold uppercase tracking-wider">竞价发言 · 下一位发言人</span>
        </div>
        <div className="space-y-2">
          {(message.biddingScores || []).map((s, idx) => {
            const m = members.get(s.memberId);
            if (!m) return null;
            const pct = (s.score / 10) * 100;
            const winner = idx === 0;
            return (
              <div key={s.memberId} className={`flex items-center gap-3 p-2 rounded-lg transition-all ${winner ? 'bg-amber-500/10 ring-1 ring-amber-400/40' : ''}`}>
                <MemberAvatar member={m} size="xs" showStatus={false} />
                <span className="text-[12px] font-semibold flex-1 min-w-0 truncate">{m.name}</span>
                <div className="flex items-center gap-2 w-40">
                  <div className="flex-1 h-1.5 rounded-full bg-surface-sunken overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${winner ? 'bg-gradient-to-r from-amber-400 to-orange-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]' : 'bg-gradient-to-r from-slate-300 to-slate-400 dark:from-white/20 dark:to-white/30'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-mono tabular-nums opacity-80 w-8 text-end">{s.score.toFixed(1)}</span>
                </div>
                {winner && <span className="material-symbols-outlined text-[16px] text-amber-500">emoji_events</span>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── 系统消息（最小化展示，长消息可折叠）──
  if (message.kind === 'system' || message.kind === 'checkpoint' || message.kind === 'intervention') {
    const content = message.content || '';
    const isLong = content.length > 60;
    const icon = message.kind === 'checkpoint' ? 'flag' : message.kind === 'intervention' ? 'back_hand' : 'info';
    return (
      <SystemMessageLine content={content} isLong={isLong} icon={icon} timestamp={message.timestamp} />
    );
  }

  // ── 思考中占位 ──
  if (message.kind === 'thinking') {
    return (
      <div className="group flex gap-2.5 py-2 px-3">
        {effectiveAuthor && <MemberAvatar member={{ ...effectiveAuthor, status: 'thinking' }} size="sm" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5 text-[11px] text-text-secondary">
            <span className="font-semibold text-text">{effectiveAuthor?.name || '—'}</span>
            <span className="opacity-60">思考中</span>
          </div>
          <div className="relative overflow-hidden inline-block px-3 py-2 rounded-xl bg-surface-raised border border-border scan-lines">
            <ThinkingDots />
          </div>
        </div>
      </div>
    );
  }

  // ── 投影入站 ──
  if (projectionIn) {
    return (
      <div className="group flex gap-2.5 py-2 px-3">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-500 text-white shrink-0 text-[14px] font-bold shadow-sm">
          <span className="material-symbols-outlined text-[18px]">person</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5 text-[11px]">
            <span className="font-semibold">{message.externalSenderName || 'External'}</span>
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] font-semibold">
              <span className="material-symbols-outlined text-[11px]">satellite_alt</span>
              {message.projectionChannel || 'projection'}
            </span>
            <span className="opacity-50 font-mono ms-1">{formatTime(message.timestamp)}</span>
          </div>
          <div className="inline-block px-3 py-2 rounded-xl bg-blue-500/5 border border-blue-500/20 max-w-[80%]">
            <div className="text-[13px] leading-relaxed text-text whitespace-pre-wrap">{message.content}</div>
          </div>
        </div>
      </div>
    );
  }

  // ── 错误消息 ──
  if (message.kind === 'error') {
    return (
      <div className="group flex gap-2.5 py-2 px-3 animate-card-enter">
        {effectiveAuthor && <MemberAvatar member={{ ...effectiveAuthor, status: 'error' }} size="sm" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5 text-[11px]">
            <span className="font-semibold text-red-600 dark:text-red-400">{effectiveAuthor?.name}</span>
            <span className="text-red-500">模型错误</span>
            <span className="opacity-50 font-mono">{formatTime(message.timestamp)}</span>
          </div>
          <div className="inline-block px-3 py-2 rounded-xl bg-red-500/5 border border-red-500/30 text-text max-w-[80%]">
            <div className="flex items-start gap-2">
              <span className="material-symbols-outlined text-[16px] text-red-500 shrink-0 mt-0.5">error</span>
              <div className="text-[13px] leading-relaxed whitespace-pre-wrap">{message.content}</div>
            </div>
            <div className="flex gap-1.5 mt-2">
              <button
                onClick={() => onRerun?.()}
                disabled={!onRerun}
                className="px-2 h-6 rounded-md text-[11px] font-semibold bg-surface hover:bg-surface-raised border border-border disabled:opacity-40 disabled:cursor-not-allowed"
              >
                强制继续
              </button>
              <button
                onClick={() => setRerunModel('')}
                disabled={!onRerun}
                className="px-2 h-6 rounded-md text-[11px] font-semibold bg-surface hover:bg-surface-raised border border-border disabled:opacity-40 disabled:cursor-not-allowed"
              >
                切换模型
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 工具调用 ──
  // v0.9：改为可折叠 ToolCallCard。默认只显示单行头部（名字 · 状态 · 结果首行），
  // 点开才展开 args/result；对连环调用（exec/write/process/…）大幅缩短占用高度。
  // tool_approval 走同一组件——用 toolStatus==='pending' 来决定是否画批准/拒绝按钮。
  if (message.kind === 'tool' || message.kind === 'tool_approval') {
    return (
      <ToolCallCard
        message={message}
        author={effectiveAuthor}
        onApproveTool={onApproveTool}
        onRejectTool={onRejectTool}
      />
    );
  }

  // ── 私聊 ──
  if (whisper) {
    const targets = (message.whisperTargetIds || []).map(id => members.get(id)?.name).filter(Boolean).join('、');
    return (
      <div className="group flex gap-2.5 py-2 px-3 animate-card-enter">
        {effectiveAuthor && <MemberAvatar member={effectiveAuthor} size="sm" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5 text-[11px]">
            <span className="font-semibold text-text">{effectiveAuthor?.name}</span>
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 text-[10px] font-semibold">
              <span className="material-symbols-outlined text-[11px]">lock</span>
              私聊 → {targets || '指定成员'}
            </span>
            <span className="opacity-50 font-mono ms-1">{formatTime(message.timestamp)}</span>
          </div>
          <div className="relative inline-block px-3 py-2 rounded-xl bg-purple-500/5 border border-dashed border-purple-400/40 max-w-[80%]">
            <div className="text-[13px] leading-relaxed text-text whitespace-pre-wrap italic">{message.content}</div>
          </div>
        </div>
      </div>
    );
  }

  // ── 默认 chat 消息 ──
  const hasReactions = message.reactions && message.reactions.length > 0;
  return (
    <div
      className={`group relative flex gap-2.5 py-2 px-3 transition-colors hover:bg-black/[0.015] dark:hover:bg-white/[0.015] ${message.kind === 'chat' && effectiveAuthor?.kind === 'agent' ? 'msg-glow-accent' : ''}`}
      onMouseLeave={() => setMenuOpen(false)}
    >
      {effectiveAuthor && (
        <MemberAvatar
          member={effectiveAuthor}
          size="sm"
          showStatus={!impersonated}
          impersonated={impersonated}
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5 text-[11px] leading-tight">
          <span className="font-semibold text-text truncate">{effectiveAuthor?.name || 'Unknown'}</span>
          {impersonated && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold">
              👻 {actingActor?.name} 扮演
            </span>
          )}
          {effectiveAuthor?.isModerator && (
            <span className="px-1 py-0 rounded bg-purple-500/10 text-purple-500 text-[9px] font-bold">MOD</span>
          )}
          {message.model && (
            <span className="opacity-40 font-mono text-[10px] hidden md:inline">{message.model}</span>
          )}
          {/* v0.6 协作质量徽章：置信度 / 立场 / 决策锚 / untrusted / humanNeeded / PII */}
          {typeof message.confidence === 'number' && message.confidence > 0 && (
            <span
              title={`自报置信度 ${message.confidence}%`}
              className={`inline-flex items-center gap-0.5 px-1.5 h-4 rounded-full text-[9px] font-semibold border ${
                message.confidence >= 80 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                : message.confidence >= 50 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30'
              }`}
            >
              <span className="material-symbols-outlined text-[9px]">psychology_alt</span>
              {message.confidence}%
            </span>
          )}
          {message.stance && message.stance !== 'agree' && (
            <span
              title="自报立场"
              className={`inline-flex items-center gap-0.5 px-1.5 h-4 rounded-full text-[9px] font-semibold border ${
                message.stance === 'disagree' ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30'
                : 'bg-slate-500/10 text-text-muted border-border'
              }`}
            >
              {message.stance === 'disagree' ? '反对' : message.stance === 'abstain' ? '弃权' : '不确定'}
            </span>
          )}
          {message.isDecision && (
            <span
              title={message.decisionSummary || '决策锚'}
              className="inline-flex items-center gap-0.5 px-1.5 h-4 rounded-full text-[9px] font-semibold border bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40"
            >
              <span className="material-symbols-outlined text-[10px]">bookmark</span>
              决策
            </span>
          )}
          {message.humanNeeded && (
            <span
              title={`Agent 请求人类介入：${message.humanNeeded}`}
              className="inline-flex items-center gap-0.5 px-1.5 h-4 rounded-full text-[9px] font-semibold border bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40 animate-pulse"
            >
              <span className="material-symbols-outlined text-[10px]">pan_tool</span>
              需人介入
            </span>
          )}
          {message.untrusted && (
            <span
              title="外部资料疑似注入，已作为数据隔离"
              className="inline-flex items-center gap-0.5 px-1.5 h-4 rounded-full text-[9px] font-semibold border bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/40"
            >
              <span className="material-symbols-outlined text-[10px]">shield</span>
              untrusted
            </span>
          )}
          {typeof message.piiRedactedCount === 'number' && message.piiRedactedCount > 0 && (
            <span
              title={`投影时已脱敏 ${message.piiRedactedCount} 处 PII / 密钥`}
              className="inline-flex items-center gap-0.5 px-1.5 h-4 rounded-full text-[9px] font-semibold border bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30"
            >
              <span className="material-symbols-outlined text-[10px]">visibility_off</span>
              脱敏{message.piiRedactedCount}
            </span>
          )}
          <span className="opacity-50 font-mono ms-auto">{formatTime(message.timestamp)}</span>
          {message.contentEdited && (
            <span className="opacity-40 text-[10px] italic">(已编辑)</span>
          )}
        </div>

        {referencedMessage && (
          <div className="mb-1 ms-0 ps-2 border-s-2 border-cyan-400/40 text-[11px] text-text-muted truncate max-w-md">
            <span className="opacity-60">↩ 回复 </span>
            {members.get(referencedMessage.authorId)?.name}：{referencedMessage.content.slice(0, 60)}
          </div>
        )}

        {editing ? (
          <div className="mt-1">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              rows={Math.min(6, draft.split('\n').length + 1)}
              className="w-full max-w-full p-2 rounded-lg bg-surface border border-cyan-500/40 sci-input text-[13px] font-sans resize-none"
              autoFocus
            />
            <div className="flex gap-1.5 mt-1">
              <button
                onClick={() => { onEdit?.(draft); setEditing(false); }}
                className="px-2.5 h-7 rounded-md text-[11px] font-bold bg-primary text-white hover:bg-primary/90"
              >
                保存改写
              </button>
              <button
                onClick={() => { setDraft(message.content); setEditing(false); }}
                className="px-2.5 h-7 rounded-md text-[11px] font-semibold bg-surface hover:bg-surface-raised border border-border"
              >
                取消
              </button>
              <span className="text-[10px] text-text-muted self-center ms-1">改写只影响 DeckX 权威版本</span>
            </div>
          </div>
        ) : (
          <div className="text-[13px] leading-relaxed text-text break-words">
            {/* content 为空但有附件时不渲染 LongTextCollapse，避免 600 字阈值算上空字符串生成空容器 */}
            {message.content && (
              <LongTextCollapse limit={600} render={(s) => (
                // agent 消息走 Markdown 渲染；人类 / 扮演 / 投影仍用纯文本保留 @ 高亮
                effectiveAuthor?.kind === 'agent'
                  ? <MarkdownView content={s} />
                  : <div className="whitespace-pre-wrap">{renderMentions(s, members)}</div>
              )}>
                {stripSilentSentinel(message.content)}
              </LongTextCollapse>
            )}
            {message.streaming && <span className="inline-block w-1.5 h-3.5 -mb-0.5 ms-0.5 bg-cyan-400 animate-cursor-blink" />}
            {/* v0.9.1：图片附件画廊 —— 缩略图最大 144×144，点击新窗口打开原图。
                不加 LongTextCollapse 折叠（图片本身视觉占位明显，没必要再隐藏一层）；
                超过 4 张滚动横向。每张鼠标悬停显示文件名 + 大小气泡。 */}
            {message.attachments && message.attachments.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {message.attachments.map((att, idx) => {
                  if (att.type !== 'image') return null;
                  // content 是纯 base64；为 <img> 拼回 data URL。MimeType 缺失时退化到 image/png。
                  const src = `data:${att.mimeType || 'image/png'};base64,${att.content}`;
                  return (
                    <a
                      key={idx}
                      href={src}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`${att.fileName || '图片'}${att.size ? ` · ${(att.size / 1024).toFixed(1)} KB` : ''} · 点击查看原图`}
                      className="group/att relative inline-block rounded-lg overflow-hidden border border-border hover:border-cyan-400/60 transition-colors max-w-[144px] max-h-[144px] bg-surface-sunken"
                    >
                      <img
                        src={src}
                        alt={att.fileName || `图片 ${idx + 1}`}
                        className="block max-w-[144px] max-h-[144px] object-contain"
                        loading="lazy"
                      />
                      <span className="absolute bottom-0 inset-x-0 px-1.5 py-0.5 bg-black/55 text-white text-[9px] font-mono truncate opacity-0 group-hover/att:opacity-100 transition-opacity">
                        {att.fileName || `image-${idx + 1}`}
                      </span>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {hasReactions && (
          <div className="mt-1 flex flex-wrap gap-1">
            {message.reactions!.map(r => (
              <button
                key={r.emoji}
                onClick={() => onReact?.(r.emoji)}
                className="inline-flex items-center gap-0.5 px-1.5 h-5 rounded-full bg-surface-raised hover:bg-surface-sunken border border-border text-[11px] transition-all"
              >
                <span>{r.emoji}</span>
                <span className="font-mono tabular-nums text-text-secondary">{r.byMemberIds.length}</span>
              </button>
            ))}
          </div>
        )}

        {!editing && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute top-1 end-2 flex items-center gap-0.5 bg-surface-overlay rounded-lg border border-border backdrop-blur-sm p-0.5 shadow-sm">
            {/* v0.9.1 新增：一键复制消息原文。放在 hover 工具条最前——
                复制是消息维度里最常用的轻量动作（高于反应/回复/分叉），
                应当零 hover 层级深度即可触达。 */}
            <button
              onClick={handleCopyContent}
              title="复制原文"
              className="w-7 h-7 rounded-md hover:bg-surface-sunken flex items-center justify-center text-text-secondary hover:text-text transition-colors"
              aria-label="复制消息原文"
            >
              <span className="material-symbols-outlined text-[15px]">content_copy</span>
            </button>
            <button
              onClick={() => setShowReactions(p => !p)}
              title="反应"
              className="w-7 h-7 rounded-md hover:bg-surface-sunken flex items-center justify-center text-text-secondary hover:text-text transition-colors"
            >
              <span className="material-symbols-outlined text-[15px]">add_reaction</span>
            </button>
            <button
              onClick={onReply}
              title="回复"
              className="w-7 h-7 rounded-md hover:bg-surface-sunken flex items-center justify-center text-text-secondary hover:text-text transition-colors"
            >
              <span className="material-symbols-outlined text-[15px]">reply</span>
            </button>
            <button
              onClick={onFork}
              title="从这里分叉"
              className="w-7 h-7 rounded-md hover:bg-surface-sunken flex items-center justify-center text-text-secondary hover:text-text transition-colors"
            >
              <span className="material-symbols-outlined text-[15px]">fork_right</span>
            </button>
            {onEdit && !isMe && effectiveAuthor?.kind === 'agent' && (
              <button
                onClick={() => setEditing(true)}
                title="编辑 AI 消息（改写权威版本）"
                className="w-7 h-7 rounded-md hover:bg-surface-sunken flex items-center justify-center text-text-secondary hover:text-text transition-colors"
              >
                <span className="material-symbols-outlined text-[15px]">edit</span>
              </button>
            )}
            {isMe && onEdit && (
              <button
                onClick={() => setEditing(true)}
                title="编辑"
                className="w-7 h-7 rounded-md hover:bg-surface-sunken flex items-center justify-center text-text-secondary hover:text-text transition-colors"
              >
                <span className="material-symbols-outlined text-[15px]">edit</span>
              </button>
            )}
            <button
              onClick={() => setMenuOpen(p => !p)}
              title="更多"
              className="w-7 h-7 rounded-md hover:bg-surface-sunken flex items-center justify-center text-text-secondary hover:text-text transition-colors"
            >
              <span className="material-symbols-outlined text-[15px]">more_horiz</span>
            </button>
          </div>
        )}

        {showReactions && (
          <div className="absolute top-9 end-2 flex items-center gap-0.5 bg-surface-overlay rounded-lg border border-border backdrop-blur-md p-1 shadow-md z-10">
            {DEFAULT_REACTIONS.map(e => (
              <button
                key={e}
                onClick={() => { onReact?.(e); setShowReactions(false); }}
                className="w-8 h-8 rounded-md hover:bg-surface-sunken flex items-center justify-center text-lg transition-all hover:scale-110"
              >{e}</button>
            ))}
          </div>
        )}

        {menuOpen && (
          <div className="absolute top-9 end-2 bg-surface-overlay rounded-lg border border-border backdrop-blur-md shadow-md z-10 min-w-[200px] py-1">
            <button onClick={() => { setMenuOpen(false); onWhisper?.(); }} className="w-full px-3 py-1.5 text-start text-[12px] hover:bg-surface-sunken flex items-center gap-2">
              <span className="material-symbols-outlined text-[15px]">lock</span>私聊此成员
            </button>
            {/* v0.6 决策锚 / 重跑（只对普通 chat/decision 消息开放） */}
            {(message.kind === 'chat' || message.kind === 'decision') && (
              <>
                <div className="my-1 h-px bg-border" />
                {message.isDecision ? (
                  onDemoteDecision && (
                    <button
                      onClick={() => { setMenuOpen(false); onDemoteDecision(); }}
                      className="w-full px-3 py-1.5 text-start text-[12px] hover:bg-surface-sunken flex items-center gap-2"
                    >
                      <span className="material-symbols-outlined text-[15px]">bookmark_remove</span>撤销决策
                    </button>
                  )
                ) : (
                  onPromoteDecision && (
                    <button
                      onClick={async () => {
                        setMenuOpen(false);
                        // 统一输入弹窗：替代浏览器原生 prompt()，保持品牌视觉一致 + 支持 Esc/Enter + 校验。
                        const s = await promptDialog({
                          title: '推为决策',
                          message: '为这条消息加一行决策摘要（留空则使用原文）',
                          defaultValue: message.decisionSummary || '',
                          placeholder: '例如：采纳方案 A，分两周内落地',
                          confirmText: '推为决策',
                          helperText: '留空即用原消息正文作为摘要',
                        });
                        if (s !== null) onPromoteDecision(s.trim() || undefined);
                      }}
                      className="w-full px-3 py-1.5 text-start text-[12px] hover:bg-surface-sunken flex items-center gap-2"
                    >
                      <span className="material-symbols-outlined text-[15px] text-emerald-500">bookmark_add</span>推为决策
                    </button>
                  )
                )}
                {onRerun && effectiveAuthor?.kind === 'agent' && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      // 打开模型选择弹窗（不再无确认重跑）。默认值 '' = 保持原模型。
                      setRerunModel('');
                    }}
                    className="w-full px-3 py-1.5 text-start text-[12px] hover:bg-surface-sunken flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[15px]">refresh</span>换模型重跑…
                  </button>
                )}
              </>
            )}
            {/*
              删除入口对所有消息开放（自己的 / agent 的 / 扮演 / 外部投影）——
              之前只允许 isMe 撤回，用户想要对 agent 说错的话也能直接清掉。
              走统一 ConfirmDialog 确认；danger 样式 + 明确文案，避免误删。
            */}
            {onDelete && (
              <>
                <div className="my-1 h-px bg-border" />
                <button
                  onClick={async () => {
                    setMenuOpen(false);
                    const ok = await confirm({
                      title: isMe ? '撤回这条消息？' : '删除这条消息？',
                      message: isMe
                        ? '撤回后对所有成员不可见，但仍保留在审计记录里。'
                        : `将删除「${effectiveAuthor?.name || '未知'}」的这条发言。撤回后对所有成员不可见，但仍保留在审计记录里。`,
                      confirmText: isMe ? '撤回' : '删除',
                      danger: true,
                    });
                    if (ok) onDelete?.();
                  }}
                  className="w-full px-3 py-1.5 text-start text-[12px] hover:bg-red-500/10 text-red-500 flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[15px]">delete</span>
                  {isMe ? '撤回' : '删除此消息'}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/*
        换模型重跑选择器 —— 统一 CustomSelect 弹窗。
        rerunModel === null 时不渲染；'' 表示保持原模型；其它字符串是具体 model id。
        不走浏览器原生 confirm；整体风格对齐 ConfirmDialog / PromptDialog。
      */}
      {rerunModel !== null && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setRerunModel(null)} />
          <div className="relative mac-glass rounded-2xl shadow-2xl overflow-hidden animate-scale-in w-[380px] backdrop-blur-3xl">
            <div className="px-6 pt-6 pb-4">
              <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-white/10 flex items-center justify-center">
                <span className="material-symbols-outlined text-[28px] text-primary">refresh</span>
              </div>
              <h3 className="text-base font-bold text-slate-800 dark:text-white mb-1 text-center">换模型重跑</h3>
              <p className="text-[12px] text-slate-600 dark:text-white/70 leading-relaxed text-center mb-4">
                将以新模型重新生成「{effectiveAuthor?.name || '此成员'}」这条回复。
              </p>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 mb-1.5">
                选择模型
              </label>
              <CustomSelect
                value={rerunModel}
                onChange={(v) => setRerunModel(v)}
                options={rerunOptions}
                className="w-full h-9 px-3 rounded-lg text-[12px] bg-white/10 dark:bg-white/5 border border-slate-200/30 dark:border-white/15"
              />
              <p className="mt-2 text-[11px] text-slate-500 dark:text-white/45">
                保持原模型 = 使用该成员当前绑定的模型；选择其他模型仅本次生效，不会修改成员配置。
              </p>
            </div>
            <div className="flex border-t border-slate-200/20 dark:border-white/10">
              <button
                onClick={() => setRerunModel(null)}
                className="flex-1 py-3.5 text-[13px] font-medium text-slate-600 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/10 transition-colors border-e border-slate-200/20 dark:border-white/10"
              >
                取消
              </button>
              <button
                onClick={() => {
                  const m = rerunModel;
                  setRerunModel(null);
                  // 空串 → 传 undefined，走后端默认（成员当前绑定模型）
                  onRerun?.(m ? m : undefined);
                }}
                className="flex-1 py-3.5 text-[13px] font-bold text-primary hover:bg-primary/10 transition-colors"
              >
                开始重跑
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// 正则缓存：members Map 引用不变时复用同一正则，避免 500+ 条消息每条都重编译。
const mentionRegexCache = new WeakMap<Map<string, Member>, RegExp | null>();
function getMentionRegex(members: Map<string, Member>): RegExp | null {
  let cached = mentionRegexCache.get(members);
  if (cached !== undefined) return cached;
  const names = Array.from(members.values()).map(m => m.name);
  if (names.length === 0) { mentionRegexCache.set(members, null); return null; }
  const re = new RegExp('(' + names.map(n => '@' + n.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|') + ')', 'g');
  mentionRegexCache.set(members, re);
  return re;
}

function renderMentions(content: string, members: Map<string, Member>): React.ReactNode {
  const re = getMentionRegex(members);
  if (!re) return content;
  const parts = content.split(re);
  return parts.map((p, i) =>
    p.startsWith('@')
      ? <span key={i} className="inline-flex items-center px-1 rounded bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-semibold">{p}</span>
      : <React.Fragment key={i}>{p}</React.Fragment>
  );
}

const MessageBubble = React.memo(MessageBubbleInner, (prev, next) => {
  if (prev.message !== next.message) return false;
  if (prev.author !== next.author) return false;
  if (prev.isMe !== next.isMe) return false;
  if (prev.referencedMessage !== next.referencedMessage) return false;
  if (prev.systemModels !== next.systemModels) return false;
  return true;
});

export default MessageBubble;
