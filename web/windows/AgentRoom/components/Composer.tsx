// 底部复合输入器 —— 输入 + @ 提及 + 策略切换 + 扮演 + 钦点 + 分叉
// 新特性：
//   - 被引用消息卡片（reference）+ 去除按钮
//   - inline @ 自动补全（输入 @ 后触发 member 下拉）
//   - slash 命令 palette（输入 / 开头触发）
import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { Member, Message, MessageAttachment, RoomPolicy } from '../types';
import { POLICY_META, MemberAvatar } from '../shared';
import Popdown from '../../../components/Popdown';

type RuntimeState = 'draft' | 'active' | 'paused' | 'awaiting_user' | 'closeout' | 'closed' | 'archived';

interface SlashCommand {
  key: string;       // '/pause'
  label: string;     // 暂停房间
  hint?: string;     // 附加说明
  action: (arg: string) => void;
}

interface Props {
  members: Member[];
  meId: string;
  policy: RoomPolicy;
  paused: boolean;
  budgetPct: number;
  disabled?: boolean;
  runtimeState?: RuntimeState;
  runtimeHint?: string;
  referenceMessage?: Message | null;
  onClearReference?: () => void;
  onSend: (content: string, opts: { mentionIds?: string[]; actingAsId?: string; whisperTargetIds?: string[]; referenceMessageId?: string; attachments?: MessageAttachment[] }) => void;
  onChangePolicy: (p: RoomPolicy) => void;
  onForceNext?: (memberId: string) => void;
  // v0.9：支持 async —— Composer 会 await 完成后再解除 loading 态。
  // 原先仅 () => void，点击后无反馈，用户误以为没生效会连点。
  onTogglePause: () => void | Promise<void>;
  onForkHere?: () => void;
  onExport?: () => void;
  onExportHtml?: () => void;
  onAddFact?: (key: string, value: string) => void;
  onAddTask?: (text: string) => void;
  onOpenHelp?: () => void;
  // v0.6
  onCloseRoom?: () => void;        // /close —— synthesize minutes
  onExtractTodo?: () => void;       // /extract-todo
  onAskAll?: (q: string) => void;   // /ask-all <question>
  onPromoteLastAsDecision?: (summary?: string) => void; // /decision [summary]
  // v0.8 nudge：/continue —— 让会议自然续一轮（也挂在 TopBar 按钮上）
  onNudge?: (text?: string) => void;
  // v1.0：竞价发言正在进行中（后端并行打分阶段），显示加载提示
  biddingInProgress?: boolean;
  // v1.0：是否有 agent 正在活动（thinking/speaking/tool），供底部状态芯片判断
  agentsActive?: boolean;
  // v1.0：“继续会议”已点击，等待 agent 响应中
  nudgePending?: boolean;
}

const POLICY_LIST: RoomPolicy[] = ['free', 'reactive', 'roundRobin', 'moderator', 'bidding', 'parallel', 'debate'];

// v1.0：底部状态芯片 —— 始终给用户一个"会议活着还是死了"的视觉锚点。
// 设计原则：非暂停态都有动态动画（pulse/spin/breathe），避免用户误以为界面卡死。
const StatusChip: React.FC<{
  effectiveState: string;
  biddingInProgress: boolean;
  agentsActive: boolean;
  nudgePending?: boolean;
}> = ({ effectiveState, biddingInProgress, agentsActive, nudgePending }) => {
  const meta = (() => {
    if (effectiveState === 'closeout') return { dot: 'bg-cyan-400 animate-spin', label: '收尾中', tone: 'text-cyan-600 dark:text-cyan-400', icon: 'progress_activity', spin: true };
    if (effectiveState === 'closed' || effectiveState === 'archived') return { dot: 'bg-slate-400', label: '已关闭', tone: 'text-text-muted', icon: 'check_circle', spin: false };
    if (effectiveState === 'paused') return { dot: 'bg-amber-400', label: '已暂停', tone: 'text-amber-600 dark:text-amber-400', icon: 'pause_circle', spin: false };
    if (effectiveState === 'draft') return { dot: 'bg-slate-400 animate-pulse', label: '待开始', tone: 'text-text-muted', icon: 'edit_calendar', spin: false };
    if (effectiveState === 'awaiting_user') return { dot: 'bg-amber-400 animate-pulse', label: '等待拍板', tone: 'text-amber-600 dark:text-amber-400', icon: 'pan_tool', spin: false };
    // active 子态
    if (biddingInProgress) return { dot: 'bg-amber-400 animate-pulse', label: '竞价中', tone: 'text-amber-600 dark:text-amber-400', icon: 'gavel', spin: true };
    if (agentsActive) return { dot: 'bg-emerald-400 animate-pulse', label: '运行中', tone: 'text-emerald-600 dark:text-emerald-400', icon: 'play_circle', spin: false };
    // v1.0：nudge 已发出，agent 还未响应 → 显示“启动中”而非“等待中”
    if (nudgePending) return { dot: 'bg-emerald-400 animate-pulse', label: '启动中', tone: 'text-emerald-600 dark:text-emerald-400', icon: 'progress_activity', spin: true };
    return { dot: 'bg-slate-400 animate-[pulse_3s_ease-in-out_infinite]', label: '等待中', tone: 'text-text-muted', icon: 'schedule', spin: false };
  })();
  return (
    <div className={`inline-flex items-center gap-1.5 px-2 h-7 rounded-md text-[10.5px] font-semibold ${meta.tone}`} title={meta.label}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
      <span className={`material-symbols-outlined text-[13px] ${meta.spin ? 'animate-spin' : ''}`}>{meta.icon}</span>
      <span className="hidden sm:inline">{meta.label}</span>
    </div>
  );
};

const Composer: React.FC<Props> = ({
  members, meId, policy, paused, budgetPct, disabled, runtimeState, runtimeHint, referenceMessage, onClearReference,
  onSend, onChangePolicy, onForceNext, onTogglePause, onForkHere,
  onExport, onExportHtml, onAddFact, onAddTask, onOpenHelp,
  onCloseRoom, onExtractTodo, onAskAll, onPromoteLastAsDecision, onNudge, biddingInProgress, agentsActive, nudgePending,
}) => {
  const [draft, setDraft] = useState('');
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  // v0.9：暂停/继续切换 loading 态 —— 点击 pause 后从发起 emergencyStop
  // 到服务端回推 paused:true 有一两秒延迟。在此期间按钮必须 disabled + spinner，
  // 避免用户以为卡死再点第二次（双触发 emergencyStop 会造成多余调用）。
  const [pauseBusy, setPauseBusy] = useState(false);
  const handlePauseClick = async () => {
    if (pauseBusy) return;
    setPauseBusy(true);
    try {
      await onTogglePause();
    } finally {
      setPauseBusy(false);
    }
  };
  const [actingAsId, setActingAsId] = useState<string | null>(null);
  const [whisperTargets, setWhisperTargets] = useState<string[]>([]);
  // 注：@ 下拉在 v0.8+ 移除 —— 输入框 @ inline autocomplete 已覆盖该场景，避免底部工具条拥挤。
  const [showActing, setShowActing] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [showWhisper, setShowWhisper] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);
  const [autoCursor, setAutoCursor] = useState(0); // 自动补全项选中索引
  const taRef = useRef<HTMLTextAreaElement>(null);

  // v0.9.1 新增：输入历史（↑/↓ 召回最近发送过的消息）。
  // 仅在组件生命周期内保留 —— Composer 随房间切换会 remount，上次房间的历史被丢弃
  // 是预期行为（不同房间话题不同，跨房间召回会给出不相关的内容）。
  // 去重：同一条消息连续发 2 次只入队 1 次；最多保留 50 条，头入尾出。
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1); // -1 = 当前正在编辑的 draft，未进入历史导航
  const draftBeforeHistoryRef = useRef<string>(''); // 进入历史导航前暂存当前 draft，按 ↓ 回到 -1 时还原

  // v0.9.1 新增：图片附件 MVP（前端 only）。
  // 价值定位：
  //   · UI 层：用户贴图/拖图 → 实时缩略预览 → 发送后在房间消息流里永久可见（ss / 示意图）。
  //   · 会议协作：代理能用文字引用图片位置（"第 2 张截图的按钮"），因为正文里有 Markdown 图像。
  // 限制：模型"视觉"需 OpenClaw 上游支持 multimodal content blocks；当前 agent RPC 的 message
  //   参数只是字符串，图片以 `![](data:image/png;base64,...)` Markdown 形式嵌入正文，
  //   视觉模型是否真正识别取决于 OpenClaw 是否解析 Markdown image → content block。
  // 约束：
  //   · 最多 4 张（超过就提醒）。
  //   · 单张 ≤ 1.5MB（避免 message content 炸大；1.5MB 图像 base64 后 ≈ 2MB 文本，对话阈值 8k 字符，
  //     实际上 1.5MB 图一张就会超过 8000 字符限制——所以 orchestrator 那边暂时跳过 content length 校验
  //     对附件消息，由 composer 侧控制单张大小 + UI 提示用户压一压）。
  const MAX_ATTACH_COUNT = 4;
  const MAX_ATTACH_BYTES = 1_500_000;
  interface PendingAttachment { id: string; dataUrl: string; mime: string; name: string; size: number; isImage: boolean; }
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const readFileAsDataURL = (file: File) => new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

  const addAttachments = async (files: File[]) => {
    const images = files.filter(f => f.type.startsWith('image/'));
    if (images.length === 0) return;
    // 容量校验 + 单张尺寸校验；超限给 UI 提示（通过 onAskAll 不合适，直接本地 alert-ish 的 console 加兜底）。
    const next: PendingAttachment[] = [];
    for (const f of images) {
      if (pendingAttachments.length + next.length >= MAX_ATTACH_COUNT) break;
      if (f.size > MAX_ATTACH_BYTES) {
        // 简单策略：跳过并打印；正规化 toast 要拉 useToast，这里保守。
        // eslint-disable-next-line no-console
        console.warn(`Composer: 图片 ${f.name} 超过 ${Math.round(MAX_ATTACH_BYTES / 1024)}KB 上限，已跳过`);
        continue;
      }
      try {
        const dataUrl = await readFileAsDataURL(f);
        next.push({
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          dataUrl, mime: f.type, name: f.name, size: f.size, isImage: true,
        });
      } catch {
        // 读取失败静默跳过
      }
    }
    if (next.length > 0) setPendingAttachments(prev => [...prev, ...next].slice(0, MAX_ATTACH_COUNT));
  };

  const removeAttachment = (id: string) => {
    setPendingAttachments(prev => prev.filter(a => a.id !== id));
  };

  // 剪贴板粘贴图片：textarea 的 onPaste 拦截剪贴板里 kind='file' 的 image。
  const onPasteCapture = async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items || []);
    const files: File[] = [];
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      await addAttachments(files);
    }
  };

  // v0.9.1：拖放视觉反馈 + 实际接收图片文件。
  // dragOver=true 时输入框边框变 cyan 虚线；drop 时读取 e.dataTransfer.files 加入队列。
  const [dragOver, setDragOver] = useState(false);
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!dragOver) setDragOver(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setDragOver(false);
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) await addAttachments(files);
  };

  const agents = members.filter(m => m.kind === 'agent' && !m.isKicked);
  const roomOver = budgetPct >= 1;
  const effectiveState = runtimeState || (disabled ? 'closed' : paused ? 'paused' : 'active');
  const waitingForUser = effectiveState === 'awaiting_user';
  const closeoutRunning = effectiveState === 'closeout';
  const closedLike = effectiveState === 'closed' || effectiveState === 'archived';
  const blocked = !!disabled || roomOver || closeoutRunning;
  const bannerMeta = closeoutRunning
    ? {
        title: '会议正在收尾总结',
        detail: runtimeHint || '系统正在生成纪要、行动项、Playbook 与复盘，请稍候，暂不接受新消息',
        tone: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
        detailTone: 'text-cyan-700/80 dark:text-cyan-200/80',
        icon: 'progress_activity',
        spin: true,
      }
    : closedLike
      ? {
          title: '会议已关闭',
          detail: runtimeHint || '当前房间仅允许查看记录与清理 AI 会话，不能继续输入或发送消息',
          tone: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
          detailTone: 'text-amber-700/80 dark:text-amber-200/80',
          icon: 'block',
          spin: false,
        }
      : waitingForUser
        ? {
            title: '等待你拍板',
            detail: runtimeHint || 'Agent 已请求人类介入。你可以直接补充背景、做决策，或继续推动下一轮讨论',
            tone: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
            detailTone: 'text-amber-700/80 dark:text-amber-200/80',
            icon: 'pan_tool',
            spin: false,
          }
        : biddingInProgress
          ? {
              title: '⚖️ 竞价评估中',
              detail: '所有 Agent 正在评估发言意愿，稍后将由最高分者发言',
              tone: 'border-amber-400/30 bg-amber-400/10 text-amber-700 dark:text-amber-300',
              detailTone: 'text-amber-600/80 dark:text-amber-200/80',
              icon: 'gavel',
              spin: true,
            }
          : null;

  // 监听从 MemberRail 发来的私聊事件
  useEffect(() => {
    const handler = (e: Event) => {
      const mid = (e as CustomEvent).detail?.memberId;
      if (!mid) return;
      setWhisperTargets(prev => prev.includes(mid) ? prev : [...prev, mid]);
      taRef.current?.focus();
    };
    window.addEventListener('agentroom:set-whisper', handler);
    return () => window.removeEventListener('agentroom:set-whisper', handler);
  }, []);

  // —— Slash 命令 palette ——
  const slashCommands: SlashCommand[] = useMemo(() => {
    const list: SlashCommand[] = [
      { key: '/pause', label: '暂停/恢复房间', hint: 'Space', action: () => onTogglePause() },
      { key: '/help', label: '快捷键帮助', hint: '?', action: () => onOpenHelp?.() },
    ];
    if (onAddFact) list.push({
      key: '/fact', label: '记录共享事实', hint: '/fact 键=值',
      action: (arg) => {
        const eq = arg.indexOf('=');
        if (eq < 0) return;
        const k = arg.slice(0, eq).trim();
        const v = arg.slice(eq + 1).trim();
        if (k && v) onAddFact(k, v);
      },
    });
    if (onAddTask) list.push({
      key: '/task', label: '新建任务', hint: '/task 任务文本',
      action: (arg) => { if (arg.trim()) onAddTask(arg.trim()); },
    });
    if (onForkHere) list.push({ key: '/fork', label: '从此刻分叉新房间', action: () => onForkHere() });
    if (onExport) list.push({ key: '/export', label: '导出房间 (Markdown)', action: () => onExport() });
    if (onExportHtml) list.push({ key: '/export-html', label: '导出为可分享 HTML 文件', action: () => onExportHtml() });
    // v0.6 协作质量
    if (onCloseRoom) list.push({
      key: '/close', label: '收尾 · 生成会议纪要', hint: '/close',
      action: () => onCloseRoom(),
    });
    if (onExtractTodo) list.push({
      key: '/extract-todo', label: '从讨论里抽取 TODO', hint: '/extract-todo',
      action: () => onExtractTodo(),
    });
    if (onAskAll) list.push({
      key: '/ask-all', label: '向所有 agent 群询', hint: '/ask-all 你的问题',
      action: (arg) => { const q = arg.trim(); if (q) onAskAll(q); },
    });
    if (onPromoteLastAsDecision) list.push({
      key: '/decision', label: '将上一条推为决策', hint: '/decision [一行摘要]',
      action: (arg) => onPromoteLastAsDecision(arg.trim() || undefined),
    });
    // v0.8 继续会议（不强迫用户手打消息即可触发下一轮）。
    // 别名 /c、/go 让键入更快；TopBar ▶ 按钮走同一路径。
    if (onNudge) {
      const nudgeCmd: SlashCommand = {
        key: '/continue', label: '继续会议（让 agent 再交锋一轮）', hint: '/continue 或 /c',
        action: (arg) => onNudge(arg.trim() || undefined),
      };
      list.push(nudgeCmd);
      list.push({ ...nudgeCmd, key: '/c', label: '继续会议（别名）' });
      list.push({ ...nudgeCmd, key: '/go', label: '继续会议（别名）' });
    }
    return list;
  }, [
    onTogglePause, onAddFact, onAddTask, onForkHere, onExport, onExportHtml, onOpenHelp,
    onCloseRoom, onExtractTodo, onAskAll, onPromoteLastAsDecision, onNudge,
  ]);

  // —— 识别当前输入中 "@" 或 "/" 触发自动补全 ——
  // 仅在光标所在的 "当前 token" 开头是 @ / / 时触发
  const autocomplete = useMemo(() => {
    const ta = taRef.current;
    if (!ta) return null;
    const pos = ta.selectionStart ?? draft.length;
    const before = draft.slice(0, pos);
    // 当前 token = 最后一次 空白 / 换行 / 起始 之后的字符
    const tokenStart = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n')) + 1;
    const token = before.slice(tokenStart);
    if (token.startsWith('@') && token.length >= 1) {
      const q = token.slice(1).toLowerCase();
      // 虚拟"所有人"条目：匹配 "所有人"、"all"、"everyone"
      const ALL_MEMBER: Member = { id: '__all__', name: '所有人', kind: 'agent', role: '全体成员', emoji: '📢' } as any;
      const allMatch = !q || '所有人'.includes(q) || 'all'.includes(q) || 'everyone'.includes(q);
      const matched = agents.filter(m =>
        m.name.toLowerCase().includes(q) || (m.role || '').toLowerCase().includes(q)
      ).slice(0, 6);
      const items = allMatch ? [ALL_MEMBER, ...matched].slice(0, 7) : matched;
      return { kind: 'mention' as const, items, tokenStart, tokenLen: token.length };
    }
    // slash 只在整行开头
    const lineStart = Math.max(before.lastIndexOf('\n'), -1) + 1;
    if (tokenStart === lineStart && token.startsWith('/')) {
      const q = token.toLowerCase();
      const items = slashCommands.filter(c => c.key.toLowerCase().startsWith(q.split(' ')[0]));
      return { kind: 'slash' as const, items, tokenStart, tokenLen: token.length };
    }
    return null;
  }, [draft, agents, slashCommands]);

  // 重置选中索引在候选变化时
  useEffect(() => { setAutoCursor(0); }, [autocomplete?.kind, autocomplete?.items.length]);

  useEffect(() => {
    if (taRef.current) {
      taRef.current.style.height = 'auto';
      taRef.current.style.height = Math.min(taRef.current.scrollHeight, 200) + 'px';
    }
  }, [draft]);

  const insertAtToken = (replacement: string, newTokenLen: number) => {
    const ta = taRef.current;
    if (!ta) return;
    const pos = ta.selectionStart ?? draft.length;
    const before = draft.slice(0, pos);
    const after = draft.slice(pos);
    const tokenStart = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n')) + 1;
    const next = draft.slice(0, tokenStart) + replacement + after;
    setDraft(next);
    // 光标移到补全文本后
    requestAnimationFrame(() => {
      ta.focus();
      const newPos = tokenStart + newTokenLen;
      ta.selectionStart = ta.selectionEnd = newPos;
    });
  };

  const acceptMention = (m: Member) => {
    if (m.id === '__all__') {
      // @所有人：把全部 agent ID 加入 mentionIds
      setMentionIds(agents.map(a => a.id));
      insertAtToken('@所有人 ', 5);
      return;
    }
    setMentionIds(p => p.includes(m.id) ? p : [...p, m.id]);
    insertAtToken(`@${m.name} `, m.name.length + 2);
  };

  const runSlash = (cmd: SlashCommand) => {
    const ta = taRef.current;
    const full = draft.trim();
    // 支持 /cmd arg 形式
    let arg = '';
    if (full.startsWith(cmd.key)) {
      arg = full.slice(cmd.key.length).trim();
    }
    cmd.action(arg);
    setDraft('');
    if (ta) ta.focus();
  };

  const send = () => {
    if (blocked) return;
    const content = draft.trim();
    // v0.9.1：允许"仅图片"消息——只要 content 或 pendingAttachments 至少一个非空就放行。
    // 图片以结构化 attachments 字段透传给后端 → orchestrator → OpenClaw `agent` RPC，
    // 而不是嵌进 Markdown 正文里（避免 base64 串污染历史 + 让多模态模型真能"看到"图片）。
    if (!content && pendingAttachments.length === 0) return;
    // 如果整条输入就是一个已知 slash 命令，执行命令而非发送消息（仅当无附件时）
    if (content.startsWith('/') && pendingAttachments.length === 0) {
      const first = content.split(/\s+/)[0];
      const match = slashCommands.find(c => c.key === first);
      if (match) { runSlash(match); return; }
    }
    // 图片 dataUrl 转 attachments：剥掉 "data:<mime>;base64," 前缀，OpenClaw 协议需要纯 base64。
    let attachments: MessageAttachment[] | undefined;
    if (pendingAttachments.length > 0) {
      attachments = pendingAttachments
        .filter(a => a.isImage)
        .map(a => {
          const m = /^data:[^;]+;base64,(.+)$/.exec(a.dataUrl);
          return {
            type: 'image' as const,
            mimeType: a.mime,
            fileName: a.name,
            content: m ? m[1] : a.dataUrl,
            size: a.size,
          };
        });
      if (attachments.length === 0) attachments = undefined;
    }
    onSend(content, {
      mentionIds: mentionIds.length ? mentionIds : undefined,
      actingAsId: actingAsId || undefined,
      whisperTargetIds: whisperTargets.length ? whisperTargets : undefined,
      referenceMessageId: referenceMessage?.id,
      attachments,
    });
    // v0.9.1：入队输入历史。同一条不连续入队 2 次；容量上限 50，超出时丢最老。
    setInputHistory(prev => {
      if (prev[0] === content) return prev;
      const next = [content, ...prev];
      return next.length > 50 ? next.slice(0, 50) : next;
    });
    setHistoryIdx(-1);
    draftBeforeHistoryRef.current = '';
    setDraft('');
    setMentionIds([]);
    setWhisperTargets([]);
    setPendingAttachments([]); // v0.9.1：图片附件已随正文发出，清空待发队列
    onClearReference?.();
    // 保持 actingAsId 直到用户手动取消
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 自动补全导航
    if (autocomplete && autocomplete.items.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAutoCursor(c => Math.min(c + 1, autocomplete.items.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAutoCursor(c => Math.max(c - 1, 0));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey)) {
        const item = autocomplete.items[autoCursor];
        if (!item) return;
        e.preventDefault();
        if (autocomplete.kind === 'mention') {
          acceptMention(item as Member);
        } else {
          runSlash(item as SlashCommand);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setAutoCursor(0);
        // 让 blur 状态自然清理 autocomplete
        return;
      }
    }
    if (blocked) {
      if (e.key === 'Enter') e.preventDefault();
      return;
    }
    // v0.9.1 Esc 分层清理（优先级从高到低）：
    //   1. 有引用消息 → 清引用
    //   2. 有扮演/私聊/mentions 徽章 → 清徽章
    //   3. 有 draft → 清 draft
    //   4. 都没有 → blur 输入框
    // 跟 Sessions 的 Esc = abort streaming 语义不同：AgentRoom 没有单次 streaming 可取消。
    if (e.key === 'Escape') {
      if (referenceMessage) { e.preventDefault(); onClearReference?.(); return; }
      if (actingAsId || whisperTargets.length > 0 || mentionIds.length > 0) {
        e.preventDefault();
        setActingAsId(null);
        setWhisperTargets([]);
        setMentionIds([]);
        return;
      }
      if (draft) {
        e.preventDefault();
        setDraft('');
        setHistoryIdx(-1);
        return;
      }
      taRef.current?.blur();
      return;
    }
    // v0.9.1 输入历史 ↑/↓ 召回。触发条件：无 autocomplete（已在上面 return）、
    // 光标在首行（↑）或末行（↓），避免打断正常的多行编辑；draft 为空或已在历史导航中时放行。
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && inputHistory.length > 0) {
      const ta = e.currentTarget;
      const caretAtStart = ta.selectionStart === 0 && ta.selectionEnd === 0;
      const caretAtEnd = ta.selectionStart === ta.value.length && ta.selectionEnd === ta.value.length;
      const inHistoryNav = historyIdx >= 0;
      if (e.key === 'ArrowUp' && (caretAtStart || inHistoryNav)) {
        e.preventDefault();
        if (historyIdx < 0) draftBeforeHistoryRef.current = draft;
        const next = Math.min(historyIdx + 1, inputHistory.length - 1);
        setHistoryIdx(next);
        setDraft(inputHistory[next]);
        // 延迟一帧把光标移到末尾，避免 setState 回写时 caret 被拉回首行
        requestAnimationFrame(() => {
          const el = taRef.current; if (!el) return;
          el.selectionStart = el.selectionEnd = el.value.length;
        });
        return;
      }
      if (e.key === 'ArrowDown' && inHistoryNav && caretAtEnd) {
        e.preventDefault();
        const next = historyIdx - 1;
        setHistoryIdx(next);
        setDraft(next < 0 ? draftBeforeHistoryRef.current : inputHistory[next]);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      // 允许 Shift+Enter 换行，默认回车发送
      e.preventDefault();
      send();
    }
  };

  const actingMember = actingAsId ? members.find(m => m.id === actingAsId) : null;

  return (
    <div className="agentroom-composer border-t border-border bg-surface-overlay backdrop-blur-md shrink-0 pb-safe ps-safe pe-safe">
      {/* 引用消息卡片 */}
      {referenceMessage && (
        <div className="mx-2 mt-2 ps-2 pe-2 py-1.5 flex items-start gap-2 rounded-lg border-s-2 border-cyan-400/60 bg-cyan-500/5">
          <span className="material-symbols-outlined text-[14px] text-cyan-500 mt-0.5">reply</span>
          <div className="flex-1 min-w-0 text-[11.5px] leading-snug">
            <span className="text-text-muted">回复 </span>
            <span className="font-semibold text-text">
              {members.find(m => m.id === referenceMessage.authorId)?.name || referenceMessage.authorId}
            </span>
            <span className="text-text-muted">：</span>
            <span className="text-text-secondary line-clamp-2">{referenceMessage.content}</span>
          </div>
          <button
            onClick={() => onClearReference?.()}
            className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-text"
            aria-label="取消引用"
          >
            <span className="material-symbols-outlined text-[13px]">close</span>
          </button>
        </div>
      )}
      {/* 干预徽章提示 */}
      {(actingAsId || whisperTargets.length > 0) && (
        <div className="px-3 pt-2 flex flex-wrap gap-2">
          {actingAsId && actingMember && (
            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[11px] font-semibold border border-amber-400/30">
              <span>👻</span>
              <span>扮演：{actingMember.name}</span>
              <button onClick={() => setActingAsId(null)} className="hover:opacity-70 ms-1">
                <span className="material-symbols-outlined text-[13px]">close</span>
              </button>
            </div>
          )}
          {whisperTargets.length > 0 && (
            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 text-[11px] font-semibold border border-purple-400/30">
              <span className="material-symbols-outlined text-[13px]">lock</span>
              <span>私聊：{whisperTargets.map(id => members.find(m => m.id === id)?.name).join('、')}</span>
              <button onClick={() => setWhisperTargets([])} className="hover:opacity-70 ms-1">
                <span className="material-symbols-outlined text-[13px]">close</span>
              </button>
            </div>
          )}
          {mentionIds.length > 0 && (
            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 text-[11px] font-semibold border border-cyan-400/30">
              <span>@</span>
              <span>{mentionIds.map(id => members.find(m => m.id === id)?.name).join('、')}</span>
              <button onClick={() => setMentionIds([])} className="hover:opacity-70 ms-1">
                <span className="material-symbols-outlined text-[13px]">close</span>
              </button>
            </div>
          )}
        </div>
      )}

      {bannerMeta && (
        <div className={`mx-2 mt-2 px-3 py-2 rounded-lg border flex items-center gap-2 ${bannerMeta.tone}`}>
          <span className={`material-symbols-outlined text-[16px] shrink-0 ${bannerMeta.spin ? 'animate-spin' : ''}`}>{bannerMeta.icon}</span>
          <div className="min-w-0">
            <div className="text-[11.5px] font-semibold">{bannerMeta.title}</div>
            <div className={`text-[10.5px] truncate ${bannerMeta.detailTone}`}>{bannerMeta.detail}</div>
          </div>
        </div>
      )}

      {/* v0.9.1：输入框上方预算进度条 —— 让用户在发送前就能看到本房间已花多少。
          只有 budgetPct > 0 才画，避免空房间顶部出现一条奇怪的进度槽。
          颜色随预算占用加深：< 70% 青色、70-90% 琥珀、> 90% 红色。 */}
      {budgetPct > 0.01 && !closedLike && (
        <div className="mx-2 mt-2 px-1 flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full bg-surface-sunken overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                budgetPct > 0.9 ? 'bg-gradient-to-r from-red-400 to-red-600'
                : budgetPct > 0.7 ? 'bg-gradient-to-r from-amber-400 to-orange-500'
                : 'bg-gradient-to-r from-cyan-400 to-blue-500'
              }`}
              style={{ width: `${Math.min(100, budgetPct * 100).toFixed(1)}%` }}
            />
          </div>
          <span className="text-[9px] font-mono tabular-nums text-text-muted shrink-0">
            {Math.min(100, budgetPct * 100).toFixed(0)}% 预算
          </span>
        </div>
      )}

      {/* 输入区 */}
      <div
        className={`relative m-2 rounded-xl border transition-all ${blocked ? 'border-border opacity-60' : dragOver ? 'border-cyan-400 border-dashed bg-cyan-500/5 ring-2 ring-cyan-400/20' : 'border-border focus-within:border-cyan-400/60 dark:focus-within:border-cyan-400/40 sci-input'} bg-surface`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* v0.9.1：图片附件预览条。仅在有 pendingAttachments 时渲染。
            缩略图 14×14 + hover 显示删除按钮 + 右上角 mime 标。 */}
        {pendingAttachments.length > 0 && (
          <div className="flex gap-1.5 px-2 pt-2 pb-1 overflow-x-auto neon-scrollbar">
            {pendingAttachments.map(att => (
              <div key={att.id} className="relative shrink-0 group/att">
                <img
                  src={att.dataUrl}
                  alt={att.name}
                  className="w-14 h-14 rounded-lg object-cover border border-border"
                />
                <button
                  onClick={() => removeAttachment(att.id)}
                  className="absolute -top-1 -end-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover/att:opacity-100 transition-opacity shadow"
                  aria-label={`移除附件 ${att.name}`}
                  title="移除"
                >
                  <span className="material-symbols-outlined text-[10px]">close</span>
                </button>
                <span className="absolute bottom-0.5 start-0.5 text-[7px] bg-black/55 text-white px-1 rounded font-mono">
                  {(att.mime.split('/')[1] || 'img').slice(0, 4)}
                </span>
              </div>
            ))}
            <div className="text-[9px] text-text-muted self-end pb-1 leading-tight">
              {pendingAttachments.length}/{MAX_ATTACH_COUNT} · vision 模型才会真正识别
            </div>
          </div>
        )}
        {/* v0.9.1：隐藏的 file input —— 由回形针按钮触发 click。仅接受图片，可多选。 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) addAttachments(files);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />
        <textarea
          ref={taRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={onKey}
          onPaste={onPasteCapture}
          placeholder={closeoutRunning
            ? '会议正在生成正式产出，请稍候…'
            : closedLike
              ? '会议已关闭，不能继续输入或发送消息'
              : waitingForUser
                ? '现在适合你来拍板、补背景或澄清约束…'
            : roomOver
              ? '预算已超上限，请调整预算或关闭房间'
              : paused
                ? '房间已暂停 · Space 键继续'
                : '输入消息…  Enter 发送，Shift+Enter 换行，@ 提及成员，/ 触发命令'}
          rows={1}
          // v0.9.1：左内边距加大为 ~36px 给"回形针"附件按钮留位（absolute 叠加到左内侧）。
          className="w-full resize-none bg-transparent ps-10 pe-3 pt-2.5 pb-9 text-[13px] leading-relaxed text-text placeholder-text-muted outline-none font-sans"
          disabled={blocked}
        />
        {/* v0.9.1：附件按钮 —— 从底部工具栏移到输入框内最左侧（参考主流 chat 输入：
            ChatGPT / Claude 把回形针放在输入框里而非外部按钮条，视觉上与"这里添加附件"
            的语义更一致）。使用 absolute 定位；textarea 已加 ps-10 留位。 */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={blocked || pendingAttachments.length >= MAX_ATTACH_COUNT}
          title={pendingAttachments.length >= MAX_ATTACH_COUNT
            ? `已达上限 ${MAX_ATTACH_COUNT} 张`
            : `添加图片（最多 ${MAX_ATTACH_COUNT} 张 · 单张 ≤ ${Math.round(MAX_ATTACH_BYTES / 1024 / 1024 * 10) / 10}MB · 仅 vision 模型识别）`}
          className="absolute start-2 top-2 inline-flex items-center justify-center w-7 h-7 rounded-md hover:bg-surface-sunken text-text-secondary hover:text-cyan-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="添加图片附件"
          type="button"
        >
          <span className="material-symbols-outlined text-[18px]">attach_file</span>
        </button>
        {/* 自动补全下拉 */}
        {autocomplete && autocomplete.items.length > 0 && (
          <div className="absolute bottom-full start-2 mb-1.5 min-w-[240px] max-w-[360px] bg-surface-overlay backdrop-blur-md rounded-lg border border-border shadow-xl py-1 z-30 animate-card-enter">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-text-muted">
              {autocomplete.kind === 'mention' ? '@ 提及成员' : '/ 命令（Tab 接受 · Esc 取消）'}
            </div>
            {autocomplete.kind === 'mention'
              ? (autocomplete.items as Member[]).map((m, idx) => (
                <button
                  key={m.id}
                  onMouseDown={e => { e.preventDefault(); acceptMention(m); }}
                  className={`w-full px-3 py-1.5 text-start text-[12px] flex items-center gap-2 ${idx === autoCursor ? 'bg-cyan-500/10' : 'hover:bg-surface-sunken'}`}
                >
                  <MemberAvatar member={m} size="xs" showStatus={false} />
                  <span className="font-semibold text-text">{m.name}</span>
                  <span className="text-[10px] text-text-muted truncate">{m.role}</span>
                </button>
              ))
              : (autocomplete.items as SlashCommand[]).map((c, idx) => (
                <button
                  key={c.key}
                  onMouseDown={e => { e.preventDefault(); runSlash(c); }}
                  className={`w-full px-3 py-1.5 text-start text-[12px] flex items-center gap-2 ${idx === autoCursor ? 'bg-cyan-500/10' : 'hover:bg-surface-sunken'}`}
                >
                  <span className="font-mono text-cyan-500 text-[11px]">{c.key}</span>
                  <span className="flex-1 truncate">{c.label}</span>
                  {c.hint && <span className="text-[10px] text-text-muted">{c.hint}</span>}
                </button>
              ))}
          </div>
        )}
        {/* 工具栏 overlay */}
        <div className="absolute inset-x-2 bottom-2 flex items-center gap-1 text-text-secondary">
          {/* @ 下拉已移除：输入框键入 @ 会弹出 inline autocomplete，功能更强且不占底部空间。 */}
          <Popdown
            label="私聊"
            title="私聊某成员"
            open={showWhisper}
            setOpen={setShowWhisper}
            disabled={closedLike}
          >
            <div className="max-h-56 overflow-y-auto neon-scrollbar">
              {members.filter(m => m.id !== meId && !m.isKicked).map(m => (
                <button
                  key={m.id}
                  onClick={() => {
                    setWhisperTargets(p => p.includes(m.id) ? p.filter(i => i !== m.id) : [...p, m.id]);
                  }}
                  className="w-full px-3 py-1.5 text-start text-[12px] hover:bg-surface-sunken flex items-center gap-2"
                >
                  <MemberAvatar member={m} size="xs" showStatus={false} />
                  <span className="flex-1 truncate">{m.name}</span>
                  {whisperTargets.includes(m.id) && <span className="material-symbols-outlined text-[15px] text-purple-500">check</span>}
                </button>
              ))}
            </div>
          </Popdown>

          <Popdown
            label="扮演"
            title="以某 Agent 身份发言"
            open={showActing}
            setOpen={setShowActing}
            disabled={closedLike}
          >
            <div className="max-h-56 overflow-y-auto neon-scrollbar">
              <button
                onClick={() => { setActingAsId(null); setShowActing(false); }}
                className="w-full px-3 py-1.5 text-start text-[12px] hover:bg-surface-sunken flex items-center gap-2 border-b border-border"
              >
                <span className="w-6 h-6 rounded-lg flex items-center justify-center bg-surface-sunken text-text-muted text-[14px]">—</span>
                <span className="flex-1">不扮演（以自己身份发言）</span>
              </button>
              {agents.map(m => (
                <button
                  key={m.id}
                  onClick={() => { setActingAsId(m.id); setShowActing(false); }}
                  className={`w-full px-3 py-1.5 text-start text-[12px] hover:bg-surface-sunken flex items-center gap-2 ${actingAsId === m.id ? 'bg-amber-500/10' : ''}`}
                >
                  <MemberAvatar member={m} size="xs" showStatus={false} />
                  <span className="flex-1 truncate">{m.name}</span>
                  {actingAsId === m.id && <span className="material-symbols-outlined text-[15px] text-amber-500">check</span>}
                </button>
              ))}
            </div>
          </Popdown>

          {/* v0.9.2：策略切换从 CustomSelect 换成 Popdown，视觉对齐相邻的 私聊/扮演/钦点。
              优势：列表项能渲染彩色圆圈图标、面板有 min-w 不会截断文字、字号统一 text-[11px]。
              触发按钮显示当前策略的图标 + label，点击后向上弹出。 */}
          <Popdown
            label={POLICY_META[policy].label}
            title="切换发言策略"
            open={showPolicy}
            setOpen={setShowPolicy}
            disabled={closedLike}
          >
            <div className="max-h-64 overflow-y-auto neon-scrollbar">
              {POLICY_LIST.map(p => {
                const meta = POLICY_META[p];
                const active = p === policy;
                return (
                  <button
                    key={p}
                    onClick={() => { onChangePolicy(p); setShowPolicy(false); }}
                    className={`w-full px-3 py-1.5 text-start text-[11px] hover:bg-surface-sunken flex items-center gap-2 whitespace-nowrap ${active ? 'bg-cyan-500/10' : ''}`}
                  >
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center bg-surface-sunken ring-1 ring-border ${meta.color}`}>
                      <span className="material-symbols-outlined text-[14px]">{meta.icon}</span>
                    </span>
                    <span className={`flex-1 ${active ? 'font-semibold text-text' : 'text-text-secondary'}`}>{meta.label}</span>
                    {active && <span className="material-symbols-outlined text-[14px] text-cyan-500">check</span>}
                  </button>
                );
              })}
            </div>
          </Popdown>

          <Popdown
            label="钦点"
            title="强制下一位发言人"
            open={showNext}
            setOpen={setShowNext}
            disabled={closedLike}
          >
            <div className="max-h-56 overflow-y-auto neon-scrollbar">
              {agents.map(m => (
                <button
                  key={m.id}
                  onClick={() => { onForceNext?.(m.id); setShowNext(false); }}
                  className="w-full px-3 py-1.5 text-start text-[12px] hover:bg-surface-sunken flex items-center gap-2"
                >
                  <MemberAvatar member={m} size="xs" showStatus={false} />
                  <span className="flex-1 truncate">{m.name}</span>
                </button>
              ))}
            </div>
          </Popdown>

          <div className="flex-1" />

          {/* v1.0：底部不再有独立暂停/继续按钮（已统一到 TopBar MeetingActions）。
              改为显示一个小型状态芯片，让用户始终感知到会议运行态。
              · 运行中（agent 正在活动）→ 绿色脉冲圆点 + "运行中"
              · 竞价评估中 → 琥珀色旋转 + "竞价中"
              · 收尾中 → 青色旋转 + "收尾中"
              · 已暂停 → 琥珀色静止 + "已暂停"
              · 空闲（active 但无 agent 活动）→ 灰色慢呼吸 + "等待中"
              · 已关闭 → 灰色 + "已关闭" */}
          <StatusChip
            effectiveState={effectiveState}
            biddingInProgress={!!biddingInProgress}
            agentsActive={!!agentsActive}
            nudgePending={!!nudgePending}
          />

          {/*
            分叉按钮已移除：每条消息的 hover 菜单已有 “从此分叉到新房间”，底部按钮重复。
            需要时仍可通过 Slash 命令 /fork 或 ⌘B 快捷键从最后一条分叉。
          */}

          {/* v0.9.1：附件按钮已移至输入框内左侧（见 textarea 上方的 absolute button）。
              底部工具栏这里只保留会议控制类按钮 + 发送。 */}
          <button
            onClick={send}
            disabled={(!draft.trim() && pendingAttachments.length === 0) || blocked}
            className={`inline-flex items-center gap-1 px-3 h-7 rounded-md text-[11px] font-bold transition-all ${(!draft.trim() && pendingAttachments.length === 0) || blocked
              ? 'bg-surface-sunken text-text-muted cursor-not-allowed'
              : 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-[0_2px_8px_rgba(0,200,255,0.3)] hover:shadow-[0_4px_16px_rgba(0,200,255,0.5)] send-btn-glow'}`}
          >
            <span className="material-symbols-outlined text-[15px]">send</span>
            <span className="hidden sm:inline">{whisperTargets.length > 0 ? '私聊' : '发送'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Composer;
