/**
 * ClawDeckX 统一模板系统
 * 
 * 完全替代旧的 data/templates.ts 和数据库模板系统
 * 
 * 架构：
 * ┌─────────────────────────────────────────────────────────────┐
 * │  在线模板源                    │  本地已安装模板              │
 * │  ├── 本地内置 (local)          │  └── 数据库 (templateApi)   │
 * │  ├── CDN 官方 (cdn)            │                             │
 * │  └── GitHub 社区 (github)      │                             │
 * └─────────────────────────────────────────────────────────────┘
 */

import { Language } from '../types';
import { templateManagerV2, ScenarioTemplate, MultiAgentTemplate, AgentTemplate } from './template-manager-v2';
import { templateSourceManager, TemplateSource } from './template-sources';
import { templateCache } from './template-loaders';
import { templateApi } from './api';

// Re-export types
export type { 
  ScenarioTemplate, 
  MultiAgentTemplate, 
  AgentTemplate,
  SkillConfig,
  CronJobConfig,
  IntegrationConfig,
  TemplateMetadata,
  TemplateRequirements,
} from './template-manager-v2';
export type { TemplateSource } from './template-sources';

// ============================================================================
// 工作区文件模板类型 (用于 SOUL.md, IDENTITY.md 等)
// ============================================================================

export interface WorkspaceTemplate {
  id: string;
  templateId: string;
  targetFile: string;
  icon: string;
  category: 'persona' | 'identity' | 'user' | 'heartbeat' | 'agents' | 'tools' | 'memory' | 'scenario' | 'multi-agent';
  tags: string[];
  author: string;
  source: 'local' | 'cdn' | 'github' | 'installed';
  builtIn: boolean;
  version: number;
  dbId?: number; // 数据库 ID（仅已安装模板）
  i18n: Record<string, {
    name: string;
    desc: string;
    content: string;
  }>;
}

// ============================================================================
// 数据库模板类型（后端返回格式）
// ============================================================================

interface DBTemplate {
  id: number;
  template_id: string;
  target_file: string;
  icon: string;
  category: string;
  tags: string;
  author: string;
  built_in: boolean;
  i18n: string;
  version: number;
}

// ============================================================================
// 统一模板系统
// ============================================================================

class TemplateSystem {
  private onlineCache = new Map<string, WorkspaceTemplate[]>();
  private installedCache: WorkspaceTemplate[] | null = null;

  // =========================================================================
  // 在线模板（从多源加载）
  // =========================================================================

  /**
   * 获取所有在线模板（合并所有启用的源）
   */
  async getOnlineTemplates(language: Language): Promise<WorkspaceTemplate[]> {
    const cacheKey = `online_${language}`;
    if (this.onlineCache.has(cacheKey)) {
      return this.onlineCache.get(cacheKey)!;
    }

    const templates: WorkspaceTemplate[] = [];

    // 从 AgentTemplate 转换为 WorkspaceTemplate
    try {
      const agentTemplates = await templateManagerV2.loadAgentTemplates(language);
      for (const t of agentTemplates) {
        templates.push(this.agentToWorkspace(t, language));
      }
    } catch (e) {
      console.warn('[TemplateSystem] Failed to load agent templates:', e);
    }

    // 从 ScenarioTemplate 转换（提取 soulSnippet 和 heartbeatSnippet）
    try {
      const scenarios = await templateManagerV2.loadScenarioTemplates(language);
      for (const s of scenarios) {
        if (s.content.soulSnippet) {
          templates.push(this.scenarioToWorkspace(s, 'SOUL.md', language));
        }
        if (s.content.heartbeatSnippet) {
          templates.push(this.scenarioToWorkspace(s, 'HEARTBEAT.md', language));
        }
      }
    } catch (e) {
      console.warn('[TemplateSystem] Failed to load scenario templates:', e);
    }

    this.onlineCache.set(cacheKey, templates);
    return templates;
  }

  /**
   * 按目标文件筛选在线模板
   */
  async getOnlineTemplatesForFile(targetFile: string, language: Language): Promise<WorkspaceTemplate[]> {
    const all = await this.getOnlineTemplates(language);
    return all.filter(t => t.targetFile === targetFile);
  }

  /**
   * 搜索在线模板
   */
  async searchOnlineTemplates(query: string, language: Language): Promise<WorkspaceTemplate[]> {
    const all = await this.getOnlineTemplates(language);
    const lowerQuery = query.toLowerCase();
    return all.filter(t => {
      const i18n = t.i18n[language] || t.i18n['en'] || Object.values(t.i18n)[0];
      return (
        i18n?.name?.toLowerCase().includes(lowerQuery) ||
        i18n?.desc?.toLowerCase().includes(lowerQuery) ||
        t.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
      );
    });
  }

  // =========================================================================
  // 已安装模板（数据库）
  // =========================================================================

  /**
   * 获取所有已安装模板
   */
  async getInstalledTemplates(): Promise<WorkspaceTemplate[]> {
    if (this.installedCache) {
      return this.installedCache;
    }

    try {
      const dbTemplates = await templateApi.list();
      this.installedCache = (dbTemplates || []).map(t => this.dbToWorkspace(t));
      return this.installedCache;
    } catch (e) {
      console.warn('[TemplateSystem] Failed to load installed templates:', e);
      return [];
    }
  }

  /**
   * 按目标文件筛选已安装模板
   */
  async getInstalledTemplatesForFile(targetFile: string): Promise<WorkspaceTemplate[]> {
    const all = await this.getInstalledTemplates();
    return all.filter(t => t.targetFile === targetFile);
  }

  /**
   * 安装在线模板到本地数据库
   */
  async installTemplate(template: WorkspaceTemplate): Promise<WorkspaceTemplate> {
    const dbData = {
      template_id: template.templateId,
      target_file: template.targetFile,
      icon: template.icon,
      category: template.category,
      tags: template.tags.join(','),
      author: template.author,
      i18n: JSON.stringify(template.i18n),
    };

    const result = await templateApi.create(dbData);
    this.installedCache = null; // 清除缓存
    
    return {
      ...template,
      source: 'installed',
      dbId: result.id,
    };
  }

  /**
   * 更新已安装模板
   */
  async updateTemplate(template: WorkspaceTemplate): Promise<void> {
    if (!template.dbId) {
      throw new Error('Cannot update template without database ID');
    }

    await templateApi.update({
      id: template.dbId,
      template_id: template.templateId,
      target_file: template.targetFile,
      icon: template.icon,
      category: template.category,
      tags: template.tags.join(','),
      author: template.author,
      i18n: JSON.stringify(template.i18n),
    });

    this.installedCache = null;
  }

  /**
   * 删除已安装模板
   */
  async removeTemplate(dbId: number): Promise<void> {
    await templateApi.remove(dbId);
    this.installedCache = null;
  }

  /**
   * 检查模板是否已安装
   */
  async isInstalled(templateId: string): Promise<boolean> {
    const installed = await this.getInstalledTemplates();
    return installed.some(t => t.templateId === templateId);
  }

  // =========================================================================
  // 合并视图（在线 + 已安装）
  // =========================================================================

  /**
   * 获取所有模板（在线 + 已安装，去重）
   */
  async getAllTemplates(language: Language): Promise<WorkspaceTemplate[]> {
    const [online, installed] = await Promise.all([
      this.getOnlineTemplates(language),
      this.getInstalledTemplates(),
    ]);

    // 已安装的优先显示
    const installedIds = new Set(installed.map(t => t.templateId));
    const onlineNotInstalled = online.filter(t => !installedIds.has(t.templateId));

    return [...installed, ...onlineNotInstalled];
  }

  /**
   * 按目标文件获取所有模板
   */
  async getAllTemplatesForFile(targetFile: string, language: Language): Promise<WorkspaceTemplate[]> {
    const all = await this.getAllTemplates(language);
    return all.filter(t => t.targetFile === targetFile);
  }

  // =========================================================================
  // 场景模板（直接访问）
  // =========================================================================

  async getScenarios(language: Language, category?: string): Promise<ScenarioTemplate[]> {
    const all = await templateManagerV2.loadScenarioTemplates(language);
    if (category) {
      return all.filter(t => t.metadata.category === category);
    }
    return all;
  }

  async getGroupedScenarios(language: Language): Promise<Record<string, ScenarioTemplate[]>> {
    const all = await templateManagerV2.loadScenarioTemplates(language);
    const groups: Record<string, ScenarioTemplate[]> = {};
    all.forEach(t => {
      const cat = t.metadata.category;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(t);
    });
    return groups;
  }

  // =========================================================================
  // 多Agent模板（直接访问）
  // =========================================================================

  async getMultiAgentTemplates(language: Language): Promise<MultiAgentTemplate[]> {
    return templateManagerV2.loadMultiAgentTemplates(language);
  }

  // =========================================================================
  // Agent预设（直接访问）
  // =========================================================================

  async getAgentTemplates(language: Language): Promise<AgentTemplate[]> {
    return templateManagerV2.loadAgentTemplates(language);
  }

  // =========================================================================
  // 搜索（跨类型）
  // =========================================================================

  async searchAll(query: string, language: Language) {
    return templateManagerV2.searchTemplates(query, language);
  }

  // =========================================================================
  // 源管理
  // =========================================================================

  getSources() {
    return templateSourceManager.getSources();
  }

  getEnabledSources() {
    return templateSourceManager.getEnabledSources();
  }

  enableSource(id: string) {
    templateSourceManager.enableSource(id);
    this.clearCache();
  }

  disableSource(id: string) {
    templateSourceManager.disableSource(id);
    this.clearCache();
  }

  // =========================================================================
  // 缓存管理
  // =========================================================================

  clearCache() {
    this.onlineCache.clear();
    this.installedCache = null;
    templateManagerV2.clearCache();
    templateCache.clear();
  }

  getCacheSize(): number {
    return templateCache.getCacheSize();
  }

  async refresh(language: Language) {
    this.clearCache();
    await templateManagerV2.refresh(language);
  }

  // =========================================================================
  // 辅助方法：解析 i18n
  // =========================================================================

  resolveI18n(template: WorkspaceTemplate, language: Language): { name: string; desc: string; content: string } {
    return template.i18n[language] || template.i18n['en'] || Object.values(template.i18n)[0] || { name: '', desc: '', content: '' };
  }

  // =========================================================================
  // 私有方法：类型转换
  // =========================================================================

  private agentToWorkspace(agent: AgentTemplate, language: Language): WorkspaceTemplate {
    return {
      id: `agent_${agent.id}`,
      templateId: agent.id,
      targetFile: 'SOUL.md',
      icon: agent.metadata.icon || 'psychology',
      category: 'persona',
      tags: agent.metadata.tags || [],
      author: agent.metadata.author || 'ClawDeckX',
      source: (agent.metadata.source as any) || 'local',
      builtIn: true,
      version: 1,
      i18n: {
        [language]: {
          name: agent.metadata.name,
          desc: agent.metadata.description,
          content: agent.content.soulSnippet || '',
        },
        en: {
          name: agent.metadata.name,
          desc: agent.metadata.description,
          content: agent.content.soulSnippet || '',
        },
      },
    };
  }

  private scenarioToWorkspace(scenario: ScenarioTemplate, targetFile: string, language: Language): WorkspaceTemplate {
    const content = targetFile === 'SOUL.md' 
      ? scenario.content.soulSnippet || ''
      : scenario.content.heartbeatSnippet || '';

    return {
      id: `scenario_${scenario.id}_${targetFile}`,
      templateId: `${scenario.id}_${targetFile.replace('.md', '').toLowerCase()}`,
      targetFile,
      icon: scenario.metadata.icon || 'auto_awesome',
      category: 'scenario',
      tags: scenario.metadata.tags || [],
      author: scenario.metadata.author || 'ClawDeckX',
      source: (scenario.metadata.source as any) || 'local',
      builtIn: true,
      version: 1,
      i18n: {
        [language]: {
          name: `${scenario.metadata.name} (${targetFile})`,
          desc: scenario.metadata.description,
          content,
        },
        en: {
          name: `${scenario.metadata.name} (${targetFile})`,
          desc: scenario.metadata.description,
          content,
        },
      },
    };
  }

  private dbToWorkspace(db: DBTemplate): WorkspaceTemplate {
    let i18n: Record<string, { name: string; desc: string; content: string }> = {};
    try {
      i18n = JSON.parse(db.i18n);
    } catch {
      i18n = { en: { name: db.template_id, desc: '', content: '' } };
    }

    return {
      id: `db_${db.id}`,
      templateId: db.template_id,
      targetFile: db.target_file,
      icon: db.icon,
      category: db.category as any,
      tags: db.tags ? db.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      author: db.author,
      source: 'installed',
      builtIn: db.built_in,
      version: db.version,
      dbId: db.id,
      i18n,
    };
  }
}

export const templateSystem = new TemplateSystem();
