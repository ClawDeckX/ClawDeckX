
export type WindowID =
  | 'dashboard' | 'gateway' | 'sessions' | 'activity' | 'alerts'
  | 'usage' | 'editor' | 'skills' | 'agents' | 'maintenance'
  | 'scheduler' | 'settings' | 'nodes' | 'setup_wizard' | 'usage_wizard' | 'observability'
  | 'knowledge' | 'terminal' | 'agentroom';

export type Language = 'en' | 'zh' | 'zh-TW' | 'ja' | 'ko';

/** Languages that use right-to-left text direction */
export const RTL_LANGUAGES: ReadonlySet<Language> = new Set<Language>();

export function isRtl(lang: Language): boolean {
  return RTL_LANGUAGES.has(lang);
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  id: WindowID;
  title: string;
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  zIndex: number;
  bounds: WindowBounds;
  prevBounds?: WindowBounds;
}

/**
 * Unified cross-window deep-link detail.
 * All `clawdeck:open-window` CustomEvents use this shape.
 */
export interface OpenWindowDetail {
  id: WindowID;
  /** Target tab within the window (e.g. 'logs', 'events', 'update', 'account') */
  tab?: string;
  /** Target panel within a tab (e.g. 'tools', 'skills', 'channels') */
  panel?: string;
  /** Editor section to scroll to */
  section?: string;
  /** Agent to select */
  agentId?: string;
  /** Session to select */
  sessionKey?: string;
  /** Knowledge item to expand */
  expandItem?: string;
  /** Event filter presets for Gateway events panel */
  eventRisk?: string;
  eventType?: string;
  eventSource?: string;
  eventKeyword?: string;
  /** Generic highlight target (e.g. a config key or list item id) */
  highlight?: string;
  /** Element to focus after navigation */
  focus?: string;
  /** Snapshot ID to auto-open restore wizard in Settings → Snapshot tab */
  snapshotId?: string;
}

/** Type-safe dispatcher for cross-window navigation */
export function dispatchOpenWindow(detail: OpenWindowDetail): void {
  window.dispatchEvent(new CustomEvent('clawdeck:open-window', { detail }));
}

export interface ActivityItem {
  id: string;
  category: 'Shell' | 'File' | 'Network' | 'Browser' | 'System';
  title: string;
  details: string;
  timestamp: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface AlertItem {
  id: string;
  time: string;
  risk: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  unread: boolean;
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  timestamp: string;
}

export interface Session {
  id: string;
  name: string;
  model: string;
  lastActive: string;
  messages: ChatMessage[];
}
