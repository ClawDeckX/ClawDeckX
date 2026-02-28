import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Language } from '../../types';
import { getTranslation } from '../../locales';
import { workflowApi, WorkflowInstance, WorkflowExecutionDefinition, gwApi } from '../../services/api';
import { MultiAgentTemplate } from '../../services/template-system';
import { useToast } from '../Toast';

interface WorkflowRunnerProps {
  template: MultiAgentTemplate;
  language: Language;
  prefix?: string;
  onClose: () => void;
}

const WorkflowRunner: React.FC<WorkflowRunnerProps> = ({ template, language, prefix, onClose }) => {
  const t = useMemo(() => getTranslation(language) as any, [language]);
  const wf = (t.workflow || {}) as any;
  const { toast } = useToast();

  const [initialTask, setInitialTask] = useState('');
  const [running, setRunning] = useState(false);
  const [instance, setInstance] = useState<WorkflowInstance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<Record<string, boolean>>({});
  const [checkingAgents, setCheckingAgents] = useState(true);

  // Check if required agents are deployed
  useEffect(() => {
    const checkAgents = async () => {
      setCheckingAgents(true);
      try {
        const agentsResp = await gwApi.proxy('agents.list', {});
        const existingAgents = new Set(
          (agentsResp?.agents || []).map((a: any) => a.id)
        );
        
        const status: Record<string, boolean> = {};
        const agentPrefix = prefix || template.id;
        for (const agent of template.content.agents) {
          const agentId = `${agentPrefix}-${agent.id}`;
          status[agent.id] = existingAgents.has(agentId);
        }
        setAgentStatus(status);
      } catch (err) {
        console.error('Failed to check agents:', err);
      } finally {
        setCheckingAgents(false);
      }
    };
    checkAgents();
  }, [template, prefix]);

  // Poll for status updates
  useEffect(() => {
    if (!instance || instance.status === 'completed' || instance.status === 'failed' || instance.status === 'stopped') {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const result = await workflowApi.status(instance.id);
        if ('id' in result) {
          setInstance(result as WorkflowInstance);
        }
      } catch (err) {
        console.error('Failed to poll workflow status:', err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [instance]);

  // Build workflow definition from template
  const buildWorkflowDefinition = useCallback((): WorkflowExecutionDefinition => {
    return {
      id: template.id,
      name: template.metadata.name,
      description: template.metadata.description,
      type: template.content.workflow.type as any,
      steps: template.content.workflow.steps.map(step => ({
        agent: step.agent,
        action: step.action,
        timeout: 300, // 5 minutes default
      })),
      agents: template.content.agents.map(a => a.id),
    };
  }, [template]);

  // Start workflow
  const handleStart = useCallback(async () => {
    if (!initialTask.trim()) {
      setError(wf.taskRequired || 'Please enter an initial task');
      return;
    }

    setRunning(true);
    setError(null);

    try {
      const definition = buildWorkflowDefinition();
      const result = await workflowApi.start({
        definition,
        initialTask: initialTask.trim(),
        prefix: prefix || template.id,
      });

      // Fetch initial status
      const status = await workflowApi.status(result.instanceId);
      if ('id' in status) {
        setInstance(status as WorkflowInstance);
      }

      toast('success', wf.started || 'Workflow started');
    } catch (err: any) {
      setError(err?.message || 'Failed to start workflow');
      toast('error', err?.message || 'Failed to start workflow');
    } finally {
      setRunning(false);
    }
  }, [initialTask, buildWorkflowDefinition, prefix, template.id, toast, wf]);

  // Stop workflow
  const handleStop = useCallback(async () => {
    if (!instance) return;

    try {
      await workflowApi.stop(instance.id);
      const status = await workflowApi.status(instance.id);
      if ('id' in status) {
        setInstance(status as WorkflowInstance);
      }
      toast('info', wf.stopped || 'Workflow stopped');
    } catch (err: any) {
      toast('error', err?.message || 'Failed to stop workflow');
    }
  }, [instance, toast, wf]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-500';
      case 'running': return 'bg-blue-500 animate-pulse';
      case 'failed': return 'bg-red-500';
      case 'stopped': return 'bg-amber-500';
      case 'pending': return 'bg-slate-400';
      case 'skipped': return 'bg-slate-300';
      default: return 'bg-slate-400';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'completed': return wf.completed || 'Completed';
      case 'running': return wf.running || 'Running';
      case 'failed': return wf.failed || 'Failed';
      case 'stopped': return wf.stopped || 'Stopped';
      case 'pending': return wf.pending || 'Pending';
      case 'skipped': return wf.skipped || 'Skipped';
      default: return status;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl mx-4 rounded-2xl bg-white dark:bg-[#1a1a2e] border border-slate-200 dark:border-white/10 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${template.metadata.color || 'from-purple-500 to-pink-500'} flex items-center justify-center`}>
              <span className="material-symbols-outlined text-white text-[20px]">play_circle</span>
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800 dark:text-white">
                {wf.runWorkflow || 'Run Workflow'}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-white/40">{template.metadata.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5">
            <span className="material-symbols-outlined text-[20px] text-slate-400">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-[12px] text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {!instance ? (
            <>
              {/* Initial Task Input */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase mb-2">
                  {wf.initialTask || 'Initial Task'}
                </label>
                <textarea
                  value={initialTask}
                  onChange={(e) => setInitialTask(e.target.value)}
                  placeholder={wf.taskPlaceholder || 'Describe the task for this workflow...'}
                  className="w-full h-32 px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] text-[12px] text-slate-700 dark:text-white/80 placeholder:text-slate-400 dark:placeholder:text-white/30 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              {/* Workflow Preview */}
              <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
                <div className="px-4 py-2 bg-slate-50 dark:bg-white/[0.02] border-b border-slate-200 dark:border-white/10">
                  <h4 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase">
                    {wf.workflowSteps || 'Workflow Steps'} ({template.content.workflow.steps.length})
                  </h4>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-white/5">
                  {template.content.workflow.steps.map((step, i) => {
                    const agent = template.content.agents.find(a => a.id === step.agent);
                    const isDeployed = agentStatus[step.agent];
                    return (
                      <div key={i} className="px-4 py-3 flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center text-[10px] font-bold text-slate-500 dark:text-white/40">
                          {i + 1}
                        </div>
                        <div className={`w-8 h-8 rounded-lg ${agent?.color || 'bg-slate-500'} flex items-center justify-center relative`}>
                          <span className="material-symbols-outlined text-white text-[14px]">{agent?.icon || 'person'}</span>
                          {!checkingAgents && (
                            <div className={`absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-white dark:border-[#1a1a2e] ${isDeployed ? 'bg-green-500' : 'bg-red-500'}`} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-bold text-slate-700 dark:text-white/80">{agent?.name || step.agent}</p>
                          <p className="text-[10px] text-slate-500 dark:text-white/40 truncate">{step.action}</p>
                        </div>
                        {!checkingAgents && !isDeployed && (
                          <span className="text-[9px] px-2 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 font-bold">
                            {wf.notDeployed || 'Not Deployed'}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Warning if agents not deployed */}
              {!checkingAgents && Object.values(agentStatus).some(v => !v) && (
                <div className="px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                  <div className="flex items-start gap-2">
                    <span className="material-symbols-outlined text-[18px] text-amber-600 shrink-0">warning</span>
                    <div>
                      <p className="text-[12px] font-bold text-amber-700 dark:text-amber-400">
                        {wf.agentsNotDeployed || 'Some agents are not deployed'}
                      </p>
                      <p className="text-[11px] text-amber-600 dark:text-amber-400/70 mt-0.5">
                        {wf.deployFirst || 'Please deploy subagents first using "Deploy Subagents" button before running the workflow.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Workflow Status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${getStatusColor(instance.status)}`} />
                  <span className="text-[12px] font-bold text-slate-700 dark:text-white/80">
                    {getStatusLabel(instance.status)}
                  </span>
                </div>
                {instance.status === 'running' && (
                  <button
                    onClick={handleStop}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-red-500/10 text-red-600 hover:bg-red-500/20"
                  >
                    <span className="material-symbols-outlined text-[14px] mr-1">stop</span>
                    {wf.stop || 'Stop'}
                  </button>
                )}
              </div>

              {/* Step Progress */}
              <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
                <div className="px-4 py-2 bg-slate-50 dark:bg-white/[0.02] border-b border-slate-200 dark:border-white/10">
                  <h4 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase">
                    {wf.progress || 'Progress'}
                  </h4>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-white/5">
                  {instance.stepResults.map((step, i) => {
                    const agentDef = template.content.agents.find(a => 
                      a.id === step.agentId || 
                      step.agentId.endsWith('-' + a.id)
                    );
                    return (
                      <div key={i} className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                            step.status === 'completed' ? 'bg-green-500' :
                            step.status === 'running' ? 'bg-blue-500 animate-pulse' :
                            step.status === 'failed' ? 'bg-red-500' :
                            'bg-slate-200 dark:bg-white/10'
                          }`}>
                            {step.status === 'completed' ? (
                              <span className="material-symbols-outlined text-white text-[14px]">check</span>
                            ) : step.status === 'running' ? (
                              <span className="material-symbols-outlined text-white text-[14px] animate-spin">sync</span>
                            ) : step.status === 'failed' ? (
                              <span className="material-symbols-outlined text-white text-[14px]">close</span>
                            ) : (
                              <span className="text-[10px] font-bold text-slate-500 dark:text-white/40">{i + 1}</span>
                            )}
                          </div>
                          <div className={`w-8 h-8 rounded-lg ${agentDef?.color || 'bg-slate-500'} flex items-center justify-center`}>
                            <span className="material-symbols-outlined text-white text-[14px]">{agentDef?.icon || 'person'}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-bold text-slate-700 dark:text-white/80">
                              {agentDef?.name || step.agentId}
                            </p>
                            <p className="text-[10px] text-slate-500 dark:text-white/40">
                              {getStatusLabel(step.status)}
                            </p>
                          </div>
                          {/* View Session Button */}
                          {(step.status === 'completed' || step.status === 'failed') && step.sessionKey && (
                            <button
                              onClick={() => {
                                // Navigate to AI Sessions with this session
                                window.dispatchEvent(new CustomEvent('navigate-to-session', { 
                                  detail: { sessionKey: step.sessionKey, agentId: step.agentId }
                                }));
                                onClose();
                              }}
                              className="px-2 py-1 rounded-lg text-[10px] font-bold bg-primary/10 text-primary hover:bg-primary/20 flex items-center gap-1"
                              title={wf.viewSession || 'View Session'}
                            >
                              <span className="material-symbols-outlined text-[12px]">chat</span>
                              {wf.viewSession || 'View'}
                            </button>
                          )}
                        </div>
                        {step.output && (
                          <div className="mt-2 ml-9 p-3 rounded-lg bg-slate-50 dark:bg-white/[0.02] text-[11px] text-slate-600 dark:text-white/60 max-h-32 overflow-y-auto">
                            <pre className="whitespace-pre-wrap font-mono">{step.output}</pre>
                          </div>
                        )}
                        {step.error && (
                          <div className="mt-2 ml-9 p-3 rounded-lg bg-red-50 dark:bg-red-500/10 text-[11px] text-red-600 dark:text-red-400">
                            {step.error}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-lg text-[11px] font-bold border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/5"
          >
            {wf.close || 'Close'}
          </button>
          {!instance && (
            <button
              onClick={handleStart}
              disabled={running || !initialTask.trim()}
              className="h-9 px-5 rounded-lg text-[11px] font-bold bg-primary text-white hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              {running ? (
                <>
                  <span className="material-symbols-outlined text-[14px] animate-spin">sync</span>
                  {wf.starting || 'Starting...'}
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[14px]">play_arrow</span>
                  {wf.start || 'Start Workflow'}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkflowRunner;
