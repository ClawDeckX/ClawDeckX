import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Language } from '../../types';
import { getTranslation } from '../../locales';
import { templateSystem, MultiAgentTemplate } from '../../services/template-system';
import { multiAgentApi, MultiAgentDeployRequest, MultiAgentGenerateResult } from '../../services/api';
import { useToast } from '../Toast';
import { FileApplyConfirm, FileApplyRequest } from '../FileApplyConfirm';
import WorkflowVisualizer from './WorkflowVisualizer';
import MultiAgentDeployWizard from './MultiAgentDeployWizard';
import WorkflowRunner from './WorkflowRunner';
import ScenarioTeamBuilder from './ScenarioTeamBuilder';
import { resolveTemplateColor } from '../../utils/templateColors';
import { subscribeManagerWS } from '../../services/manager-ws';

interface MultiAgentCollaborationProps {
  language: Language;
  defaultAgentId?: string;
  onDeploy?: (template: MultiAgentTemplate) => void;
}

const MultiAgentCollaborationV2: React.FC<MultiAgentCollaborationProps> = ({ language, defaultAgentId, onDeploy }) => {
  const t = useMemo(() => getTranslation(language) as any, [language]);
  const ma = (t.multiAgent || {}) as any;
  const s = (t.scenarios || {}) as any;
  const { toast } = useToast();

  const [templates, setTemplates] = useState<MultiAgentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deploying, setDeploying] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<MultiAgentTemplate | null>(null);
  const [applyRequest, setApplyRequest] = useState<FileApplyRequest | null>(null);
  const [viewMode, setViewMode] = useState<'visual' | 'list'>('visual');
  const [deployWizardTemplate, setDeployWizardTemplate] = useState<MultiAgentTemplate | null>(null);
  const [workflowRunnerTemplate, setWorkflowRunnerTemplate] = useState<MultiAgentTemplate | null>(null);
  const [showTeamBuilder, setShowTeamBuilder] = useState(false);
  const [aiDeployRequest, setAiDeployRequest] = useState<{ request: MultiAgentDeployRequest; reasoning: string } | null>(null);
  // Background generation task — persists even when builder window is closed
  const [bgTaskId, setBgTaskId] = useState<string | null>(null);
  const [bgTaskDone, setBgTaskDone] = useState<MultiAgentGenerateResult | null>(null);
  const bgTaskIdRef = useRef<string | null>(null);
  bgTaskIdRef.current = bgTaskId;

  // Subscribe to gen_task WS events globally to handle background generation
  useEffect(() => {
    const unsub = subscribeManagerWS((msg: any) => {
      if (msg?.type !== 'gen_task') return;
      const { taskId, status, result } = msg.data ?? {};
      if (!bgTaskIdRef.current || taskId !== bgTaskIdRef.current) return;
      if (status === 'done' && result) {
        setBgTaskDone(result as MultiAgentGenerateResult);
        setBgTaskId(null);
        // Show toast so user knows they can view the result
        toast('success', (t.scenarioTeamBuilder as any)?.bgDoneToast || 'AI team generation complete — tap to view');
      } else if (status === 'failed') {
        setBgTaskId(null);
        toast('error', (t.scenarioTeamBuilder as any)?.bgFailedToast || 'AI team generation failed');
      }
    });
    return unsub;
  }, [t, toast]);

  // When bgTaskDone result arrives and builder is closed, auto-open builder so user sees preview
  useEffect(() => {
    if (bgTaskDone && !showTeamBuilder) {
      setShowTeamBuilder(true);
    }
  }, [bgTaskDone]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load templates
  useEffect(() => {
    setLoading(true);
    templateSystem.getMultiAgentTemplates(language)
      .then(data => {
        setTemplates(data.filter(t => t.id !== 'default'));
        setError(null);
      })
      .catch(err => setError(err))
      .finally(() => setLoading(false));
  }, [language]);

  const selectedTemplate = useMemo(() => {
    return templates.find((t) => t.id === selectedId) || null;
  }, [templates, selectedId]);

  // Build file apply request for quick deploy with intelligent block management
  const handleQuickDeploy = useCallback(
    (template: MultiAgentTemplate) => {
      if (!defaultAgentId) {
        toast('error', s.noAgentSelected || 'No agent selected');
        return;
      }

      const files = [];
      const workflowId = template.id;
      const blockStart = `<!-- workflow:${workflowId} -->`;
      const blockEnd = `<!-- /workflow:${workflowId} -->`;

      // Generate agent list for sessions_spawn
      const agentIds = template.content.agents.map(a => a.id);
      const agentList = template.content.agents.map(agent => 
        `- **${agent.id}**: ${agent.name} - ${agent.role}`
      ).join('\n');

      // Generate workflow steps
      const workflowSteps = template.content.workflow.steps.map((step, idx) => 
        `${idx + 1}. ${step.agent}: ${step.action}`
      ).join('\n');

      // Build SOUL.md content with sessions_spawn instructions
      const soulContent = `
${blockStart}
## ${template.metadata?.name ?? template.id}

${template.metadata?.description ?? ''}

### Available Subagents

${agentList}

### How to Use

When you receive a task related to this workflow, use the \`sessions_spawn\` tool to delegate to the appropriate subagent:

\`\`\`
sessions_spawn(task="your task description", agentId="agent-id")
\`\`\`

### Workflow Steps

${workflowSteps}

### Tips

- Analyze the task first, then decide which subagent is most suitable
- You can spawn multiple subagents for complex tasks
- Subagents will automatically report back when they complete their work
- Available agent IDs: ${agentIds.join(', ')}
${blockEnd}
`;

      files.push({
        fileName: 'SOUL.md',
        mode: 'append' as const,
        content: soulContent,
        blockId: workflowId,
      });

      // Generate HEARTBEAT.md content with block markers
      const heartbeatContent = `
${blockStart}
## ${template.metadata?.name ?? template.id} Workflow

${template.content.workflow.steps.map((step, idx) => 
  `- [ ] Step ${idx + 1} (${step.agent}): ${step.action}`
).join('\n')}
${blockEnd}
`;

      files.push({
        fileName: 'HEARTBEAT.md',
        mode: 'append' as const,
        content: heartbeatContent,
        blockId: workflowId,
      });

      if (files.length === 0) {
        toast('error', 'No content to apply');
        return;
      }

      setApplyRequest({
        agentId: defaultAgentId,
        files,
        title: `${ma.quickSetupConfirmTitle || 'Enhance Agent'}: ${template.metadata?.name ?? template.id}`,
        description: ma.quickSetupConfirmDesc || 'This will add workflow capabilities to the current agent',
      });
    },
    [defaultAgentId, s, ma, toast]
  );

  const handleApplyDone = useCallback(() => {
    setApplyRequest(null);
    toast('success', ma.quickSetupSuccess || 'Agent capabilities enhanced');
  }, [ma, toast]);

  // Full deploy via API (creates multiple independent agents)
  const handleFullDeploy = useCallback(
    async (template: MultiAgentTemplate) => {
      setDeploying(template.id);
      try {
        // Build deployment request from template
        const deployRequest = {
          template: {
            id: template.id,
            name: template.metadata?.name ?? template.id,
            description: template.metadata?.description ?? '',
            agents: template.content.agents.map(agent => ({
              id: agent.id,
              name: agent.name,
              role: agent.role,
              description: agent.description,
              icon: agent.icon,
              color: agent.color,
              soul: `# ${agent.name}\n\n**Role:** ${agent.role}\n\n${agent.description || ''}`,
            })),
            workflow: template.content.workflow,
          },
          prefix: template.id,
          skipExisting: true,
        };
        
        const result = await multiAgentApi.deploy(deployRequest);
        if (result.success) {
          toast('success', `${ma.deploySuccess || 'Deployment successful'} (${result.deployedCount} agents)`);
          onDeploy?.(template);
        } else {
          toast('error', result.errors?.join(', ') || ma.deployFailed || 'Deployment failed');
        }
      } catch (err: any) {
        toast('error', err?.message || ma.deployFailed || 'Deployment failed');
      } finally {
        setDeploying(null);
      }
    },
    [ma, onDeploy, toast]
  );

  const getWorkflowTypeLabel = useCallback(
    (type: string) => {
      const labels: Record<string, string> = {
        standalone: ma.workflowStandalone || 'Standalone',
        sequential: ma.workflowSequential || 'Sequential',
        parallel: ma.workflowParallel || 'Parallel',
        collaborative: ma.workflowCollaborative || 'Collaborative',
        'event-driven': ma.workflowEventDriven || 'Event-Driven',
        routing: ma.workflowRouting || 'Routing',
      };
      return labels[type] || type;
    },
    [ma]
  );

  const getWorkflowTypeColor = useCallback((type: string) => {
    const colors: Record<string, string> = {
      standalone: 'bg-violet-500/10 text-violet-500',
      sequential: 'bg-blue-500/10 text-blue-500',
      parallel: 'bg-green-500/10 text-green-500',
      collaborative: 'bg-purple-500/10 text-purple-500',
      'event-driven': 'bg-orange-500/10 text-orange-500',
      routing: 'bg-cyan-500/10 text-cyan-500',
    };
    return colors[type] || 'bg-slate-500/10 text-slate-500';
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="material-symbols-outlined text-[24px] text-primary animate-spin">progress_activity</span>
        <span className="ms-2 text-[11px] text-slate-500 dark:text-white/40">{ma.loading || 'Loading...'}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <span className="material-symbols-outlined text-[32px] text-red-500">error</span>
        <p className="mt-2 text-[11px] text-red-500">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-sm font-bold text-slate-800 dark:text-white">{ma.title || 'Multi-Agent Collaboration'}</h3>
        <p className="text-[11px] text-slate-500 dark:text-white/40">{ma.subtitle || 'Deploy collaborative agent teams'}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Template List */}
        <div className="lg:col-span-1 space-y-2">
          {/* AI Custom Team Entry Card */}
          <button
            onClick={() => setShowTeamBuilder(true)}
            className="w-full text-start p-3 rounded-xl border-2 border-dashed border-violet-400/40 dark:border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-purple-600/5 hover:border-violet-500/60 hover:from-violet-500/10 hover:to-purple-600/10 transition-all group"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-gradient-to-br from-violet-500 to-purple-600 group-hover:shadow-lg group-hover:shadow-violet-500/30 transition-shadow">
                <span className="material-symbols-outlined text-white text-[20px]">auto_awesome</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <h4 className="text-[12px] font-bold text-violet-700 dark:text-violet-400">
                    {(t.scenarioTeamBuilder as any)?.cardTitle || 'AI Custom Team'}
                  </h4>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-violet-500/10 text-violet-600 dark:text-violet-400">
                    AI
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-white/40 mt-0.5 line-clamp-2">
                  {(t.scenarioTeamBuilder as any)?.cardDesc || 'Describe your scenario, AI auto-designs agents with SOUL.md & HEARTBEAT.md'}
                </p>
              </div>
            </div>
          </button>

          {templates.map((template) => (
            <button
              key={template.id}
              onClick={() => setSelectedId(template.id)}
              className={`w-full text-start p-3 rounded-xl border transition-all ${
                selectedId === template.id
                  ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/20'
                  : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] hover:border-slate-300 dark:hover:border-white/20'
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                  style={resolveTemplateColor(template.metadata?.color)}
                >
                  <span className="material-symbols-outlined text-white text-[20px]">{template.metadata?.icon || 'groups'}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-[12px] font-bold text-slate-800 dark:text-white truncate">{template.metadata?.name ?? template.id}</h4>
                  <p className="text-[10px] text-slate-500 dark:text-white/40 mt-0.5 line-clamp-2">{template.metadata?.description ?? ''}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[9px] text-slate-400 dark:text-white/30">
                      {template.content.agents.length} {ma.agents || 'agents'}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${getWorkflowTypeColor(template.content.workflow.type)}`}>
                      {getWorkflowTypeLabel(template.content.workflow.type)}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Template Detail */}
        <div className="lg:col-span-2">
          {selectedTemplate ? (
            <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] overflow-hidden">
              {/* Header */}
              <div className="p-4 border-b border-slate-100 dark:border-white/5">
                <div className="flex items-start gap-3">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                    style={resolveTemplateColor(selectedTemplate.metadata?.color)}
                  >
                    <span className="material-symbols-outlined text-white text-[24px]">{selectedTemplate.metadata?.icon || 'groups'}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-white">{selectedTemplate.metadata?.name ?? selectedTemplate.id}</h3>
                    <p className="text-[11px] text-slate-500 dark:text-white/40 mt-0.5">{selectedTemplate.metadata?.description ?? ''}</p>
                  </div>
                </div>
              </div>

              {/* Deploy Mode Selector */}
              <div className="p-4 border-b border-slate-100 dark:border-white/5">
                <h4 className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/30 mb-3">
                  {ma.deployModeTitle || 'Choose Deployment Mode'}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Option 1: Enhance Agent */}
                  <button
                    onClick={() => handleQuickDeploy(selectedTemplate)}
                    disabled={deploying === selectedTemplate.id || !defaultAgentId}
                    className="p-4 rounded-xl border-2 border-primary/30 dark:border-primary/20 bg-primary/5 hover:bg-primary/10 disabled:opacity-50 text-start transition-all group"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="material-symbols-outlined text-[20px] text-primary">auto_awesome</span>
                      <span className="text-[12px] font-bold text-primary">{ma.deployModeEnhance || 'Enhance Existing Agent'}</span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-green-500/10 text-green-600">
                        {ma.deployModeEnhanceRecommend || 'Recommended'}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-600 dark:text-white/50 leading-relaxed">
                      {ma.deployModeEnhanceDesc || 'Add workflow capabilities to the current agent. Best for quick start.'}
                    </p>
                  </button>

                  {/* Option 2: Deploy Subagents */}
                  <button
                    onClick={() => setDeployWizardTemplate(selectedTemplate)}
                    disabled={deploying === selectedTemplate.id}
                    className="p-4 rounded-xl border border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20 hover:bg-slate-50 dark:hover:bg-white/[0.02] disabled:opacity-50 text-start transition-all group"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="material-symbols-outlined text-[20px] text-slate-500 dark:text-white/50 group-hover:text-slate-700 dark:group-hover:text-white/70">rocket_launch</span>
                      <span className="text-[12px] font-bold text-slate-700 dark:text-white/70">{ma.deployModeDeploy || 'Deploy Independent Subagents'}</span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-600">
                        {ma.deployModeDeployAdvanced || 'Advanced'}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-white/40 leading-relaxed">
                      {ma.deployModeDeployDesc || 'Create multiple independent subagents. Best for complex tasks.'}
                    </p>
                  </button>
                </div>

                {/* Run Button */}
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/5">
                  <button
                    onClick={() => setWorkflowRunnerTemplate(selectedTemplate)}
                    className="w-full h-10 rounded-xl text-[12px] font-bold bg-green-600 text-white hover:bg-green-700 flex items-center justify-center gap-2 transition-all"
                    title={ma.runWorkflow || 'Run this workflow'}
                  >
                    <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                    {ma.runWorkflow || 'Run Workflow'}
                  </button>
                </div>
              </div>

              {/* Agents */}
              <div className="p-4 border-b border-slate-100 dark:border-white/5">
                <h4 className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/30 mb-3">{ma.teamMembers || 'Team Members'}</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {selectedTemplate.content.agents.map((agent) => (
                    <div key={agent.id} className="text-center">
                      <div
                        className="w-12 h-12 mx-auto rounded-xl flex items-center justify-center mb-2"
                        style={resolveTemplateColor(agent.color)}
                      >
                        <span className="material-symbols-outlined text-white text-[20px]">{agent.icon || 'person'}</span>
                      </div>
                      <p className="text-[11px] font-bold text-slate-700 dark:text-white/80">{agent.name}</p>
                      <p className="text-[9px] text-slate-500 dark:text-white/40 mt-0.5">{agent.role}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Workflow Visualization */}
              <div className="p-4 border-b border-slate-100 dark:border-white/5">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/30">{ma.workflow || 'Workflow'}</h4>
                  <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-white/5">
                    <button
                      onClick={() => setViewMode('visual')}
                      className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${viewMode === 'visual' ? 'bg-white dark:bg-white/10 text-primary shadow-sm' : 'text-slate-500 dark:text-white/40'}`}
                    >
                      <span className="material-symbols-outlined text-[14px]">hub</span>
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${viewMode === 'list' ? 'bg-white dark:bg-white/10 text-primary shadow-sm' : 'text-slate-500 dark:text-white/40'}`}
                    >
                      <span className="material-symbols-outlined text-[14px]">list</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <span className={`px-2 py-1 rounded text-[10px] font-bold ${getWorkflowTypeColor(selectedTemplate.content.workflow.type)}`}>
                    {getWorkflowTypeLabel(selectedTemplate.content.workflow.type)}
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-white/40">{selectedTemplate.content.workflow.description}</span>
                </div>

                {/* Visual Mode - Graph */}
                {viewMode === 'visual' && (
                  <div className="flex justify-center">
                    <WorkflowVisualizer
                      agents={selectedTemplate.content.agents}
                      workflow={selectedTemplate.content.workflow}
                      language={language}
                      compact={false}
                    />
                  </div>
                )}

                {/* List Mode - Steps */}
                {viewMode === 'list' && (
                  <div className="relative">
                    <div className="absolute start-4 top-0 bottom-0 w-0.5 bg-slate-200 dark:bg-white/10" />
                    <div className="space-y-3">
                      {selectedTemplate.content.workflow.steps.map((step, idx) => {
                        const agentIds = step.agents || (step.agent ? [step.agent] : []);
                        const agents = agentIds
                          .map((id) => selectedTemplate.content.agents.find((a) => a.id === id))
                          .filter(Boolean);

                        return (
                          <div key={idx} className="relative flex items-start gap-3 ps-8">
                            <div className="absolute start-2.5 top-1 w-3 h-3 rounded-full bg-primary border-2 border-white dark:border-[#1a1a2e]" />
                            <div className="flex-1 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02] p-2">
                              <div className="flex items-center gap-2 mb-1">
                                {agents.map((agent) => (
                                  <span
                                    key={agent!.id}
                                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${agent!.color || 'bg-slate-500'} text-white`}
                                  >
                                    {agent!.name}
                                  </span>
                                ))}
                                {step.parallel && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-green-500/10 text-green-500">
                                    {ma.parallel || 'Parallel'}
                                  </span>
                                )}
                                {step.condition && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-500">
                                    {step.condition}
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-slate-600 dark:text-white/50">{step.action}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Examples */}
              {selectedTemplate.content.examples && selectedTemplate.content.examples.length > 0 && (
                <div className="p-4">
                  <h4 className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/30 mb-2">{ma.useCases || 'Use Cases'}</h4>
                  <div className="space-y-1">
                    {selectedTemplate.content.examples.map((ex, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-[10px]">
                        <span className="text-primary shrink-0">•</span>
                        <span className="text-slate-600 dark:text-white/50">{ex}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Requirements */}
              {selectedTemplate.requirements && (selectedTemplate.requirements.skills?.length || selectedTemplate.requirements.channels?.length) ? (
                <div className="p-4 border-t border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-black/20">
                  <h4 className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/30 mb-2">{ma.requirements || 'Requirements'}</h4>
                  <div className="flex flex-wrap gap-1">
                    {selectedTemplate.requirements.skills?.map((skill) => (
                      <span key={skill} className="px-1.5 py-0.5 rounded bg-blue-500/10 text-[9px] text-blue-500">
                        {skill}
                      </span>
                    ))}
                    {selectedTemplate.requirements.channels?.map((ch) => (
                      <span key={ch} className="px-1.5 py-0.5 rounded bg-green-500/10 text-[9px] text-green-500">
                        {ch}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02] flex items-center justify-center h-64">
              <div className="text-center">
                <span className="material-symbols-outlined text-[32px] text-slate-300 dark:text-white/20">groups</span>
                <p className="mt-2 text-[11px] text-slate-400 dark:text-white/30">{ma.selectTemplate || 'Select a template to view details'}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* File Apply Confirmation Dialog */}
      {applyRequest && (
        <FileApplyConfirm
          request={applyRequest}
          locale={{
            ...((t.fileApply as any) || {}),
            title: ma.quickSetupConfirmTitle || (t.fileApply as any)?.title || 'Enhance Agent Capabilities',
            applied: ma.quickSetupSuccess || (t.fileApply as any)?.applied || 'Agent capabilities enhanced',
          }}
          onDone={handleApplyDone}
          onCancel={() => setApplyRequest(null)}
        />
      )}

      {/* Multi-Agent Combination Tip */}
      <div className="mt-6 p-4 rounded-xl bg-purple-50 dark:bg-purple-500/5 border border-purple-200 dark:border-purple-500/20">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-[20px] text-purple-500 shrink-0 mt-0.5">groups</span>
          <div className="flex-1 min-w-0">
            <h4 className="text-[12px] font-bold text-purple-900 dark:text-purple-300 mb-1">
              {ma.collaborationTipTitle || '💡 Multi-Agent Collaboration'}
            </h4>
            <p className="text-[11px] text-purple-700 dark:text-purple-400 leading-relaxed">
              {ma.collaborationTipDesc || 'Choose "Enhance Agent" to teach the main agent how to call subagents, or "Deploy Subagents" to create independent specialized agents. After deployment, the main agent will automatically use sessions_spawn to call appropriate subagents.'}
            </p>
          </div>
        </div>
      </div>

      {/* Scenario Team Builder Modal */}
      {showTeamBuilder && (
        <ScenarioTeamBuilder
          language={language}
          onClose={() => { setShowTeamBuilder(false); setBgTaskDone(null); }}
          onReadyToDeploy={(request, reasoning) => {
            setShowTeamBuilder(false);
            setBgTaskDone(null);
            setBgTaskId(null);
            setAiDeployRequest({ request, reasoning });
          }}
          pendingTaskId={bgTaskId && !bgTaskDone ? bgTaskId : undefined}
          completedResult={bgTaskDone ?? undefined}
          onTaskSubmitted={(taskId) => {
            setBgTaskId(taskId);
            setBgTaskDone(null);
          }}
        />
      )}

      {/* Background generation in-progress indicator */}
      {bgTaskId && !showTeamBuilder && (
        <button
          onClick={() => setShowTeamBuilder(true)}
          className="fixed bottom-5 end-5 z-50 flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-600 text-white text-[11px] font-bold shadow-lg shadow-violet-500/30 hover:bg-violet-700 transition-all animate-pulse"
        >
          <span className="material-symbols-outlined text-[15px]">auto_awesome</span>
          {(t.scenarioTeamBuilder as any)?.bgRunningBadge || 'AI generating team...'}
        </button>
      )}

      {/* AI-Generated Deploy Wizard */}
      {aiDeployRequest && (
        <MultiAgentDeployWizard
          template={{
            id: aiDeployRequest.request.template.id,
            version: '1.0.0',
            type: 'multi-agent' as const,
            metadata: {
              name: aiDeployRequest.request.template.name,
              description: aiDeployRequest.request.template.description,
              category: 'custom',
              difficulty: 'medium' as const,
              icon: 'auto_awesome',
              color: 'from-violet-500 to-purple-600',
              tags: ['ai-generated', 'custom'],
              author: 'AI',
            },
            requirements: { skills: [], channels: [] },
            content: {
              agents: aiDeployRequest.request.template.agents.map(a => ({
                id: a.id,
                name: a.name,
                role: a.role,
                description: a.description,
                icon: a.icon,
                color: a.color,
                soulSnippet: a.soul,
                soul: a.soul,
                agentsMd: a.agentsMd,
                userMd: a.userMd,
                identityMd: a.identityMd,
                heartbeat: a.heartbeat,
              })),
              workflow: aiDeployRequest.request.template.workflow,
              examples: [],
            },
          }}
          language={language}
          onClose={() => setAiDeployRequest(null)}
          onDeployed={() => {
            onDeploy?.(null as any);
          }}
        />
      )}

      {/* Deploy Wizard Modal */}
      {deployWizardTemplate && (
        <MultiAgentDeployWizard
          template={deployWizardTemplate}
          language={language}
          onClose={() => {
            setDeployWizardTemplate(null);
          }}
          onDeployed={() => {
            // Don't close the wizard here - let user see the result page
            // The wizard will be closed when user clicks "Done"
            onDeploy?.(deployWizardTemplate);
          }}
        />
      )}

      {/* Workflow Runner Modal */}
      {workflowRunnerTemplate && (
        <WorkflowRunner
          template={workflowRunnerTemplate}
          language={language}
          prefix={workflowRunnerTemplate.id}
          onClose={() => setWorkflowRunnerTemplate(null)}
        />
      )}

    </div>
  );
};

export default MultiAgentCollaborationV2;
