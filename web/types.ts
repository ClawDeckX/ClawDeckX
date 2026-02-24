
export type WindowID =
  | 'dashboard' | 'gateway' | 'sessions' | 'activity' | 'alerts'
  | 'config_mgmt' | 'editor' | 'skills' | 'security' | 'agents'
  | 'scheduler' | 'settings' | 'nodes' | 'setup_wizard' | 'usage_wizard';

export type Language = 'zh' | 'en' | 'ja' | 'ko' | 'es' | 'pt-BR' | 'de' | 'fr' | 'ru' | 'zh-TW';

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
