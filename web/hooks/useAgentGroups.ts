import { useState, useEffect, useCallback, useRef } from 'react';
import { settingsApi } from '../services/api';

const SETTING_KEY = 'agent_groups';

export interface AgentGroup {
  name: string;
  agentIds: string[];
  collapsed?: boolean;
}

export interface AgentGroupsState {
  groups: AgentGroup[];
  loaded: boolean;
  /** Move an agent into a group. Creates group if it doesn't exist. */
  moveToGroup: (agentId: string, groupName: string) => void;
  /** Remove an agent from all groups (back to ungrouped). */
  ungroup: (agentId: string) => void;
  /** Create a new empty group. */
  createGroup: (name: string) => void;
  /** Rename a group. */
  renameGroup: (oldName: string, newName: string) => void;
  /** Delete a group (agents become ungrouped). */
  deleteGroup: (name: string) => void;
  /** Toggle collapsed state for a group. */
  toggleCollapse: (name: string) => void;
  /** Reorder groups by name list. */
  reorderGroups: (names: string[]) => void;
}

export function useAgentGroups(): AgentGroupsState {
  const [groups, setGroups] = useState<AgentGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load from backend on mount
  useEffect(() => {
    settingsApi.getAll().then((all: any) => {
      const raw = all?.[SETTING_KEY];
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setGroups(parsed);
        } catch { /* ignore corrupt data */ }
      }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  // Debounced save to backend
  const persist = useCallback((next: AgentGroup[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      settingsApi.update({ [SETTING_KEY]: JSON.stringify(next) }).catch(() => {});
    }, 400);
  }, []);

  const update = useCallback((fn: (prev: AgentGroup[]) => AgentGroup[]) => {
    setGroups(prev => {
      const next = fn(prev);
      persist(next);
      return next;
    });
  }, [persist]);

  const moveToGroup = useCallback((agentId: string, groupName: string) => {
    update(prev => {
      // Remove from any existing group
      let next = prev.map(g => ({
        ...g,
        agentIds: g.agentIds.filter(id => id !== agentId),
      }));
      // Find or create target group
      const target = next.find(g => g.name === groupName);
      if (target) {
        target.agentIds.push(agentId);
      } else {
        next.push({ name: groupName, agentIds: [agentId] });
      }
      return next;
    });
  }, [update]);

  const ungroup = useCallback((agentId: string) => {
    update(prev => prev.map(g => ({
      ...g,
      agentIds: g.agentIds.filter(id => id !== agentId),
    })));
  }, [update]);

  const createGroup = useCallback((name: string) => {
    update(prev => {
      if (prev.some(g => g.name === name)) return prev;
      return [...prev, { name, agentIds: [] }];
    });
  }, [update]);

  const renameGroup = useCallback((oldName: string, newName: string) => {
    update(prev => prev.map(g => g.name === oldName ? { ...g, name: newName } : g));
  }, [update]);

  const deleteGroup = useCallback((name: string) => {
    update(prev => prev.filter(g => g.name !== name));
  }, [update]);

  const toggleCollapse = useCallback((name: string) => {
    update(prev => prev.map(g => g.name === name ? { ...g, collapsed: !g.collapsed } : g));
  }, [update]);

  const reorderGroups = useCallback((names: string[]) => {
    update(prev => {
      const map = new Map(prev.map(g => [g.name, g]));
      const ordered: AgentGroup[] = [];
      for (const n of names) {
        const g = map.get(n);
        if (g) ordered.push(g);
      }
      // Append any not in the new order
      for (const g of prev) {
        if (!names.includes(g.name)) ordered.push(g);
      }
      return ordered;
    });
  }, [update]);

  return { groups, loaded, moveToGroup, ungroup, createGroup, renameGroup, deleteGroup, toggleCollapse, reorderGroups };
}
