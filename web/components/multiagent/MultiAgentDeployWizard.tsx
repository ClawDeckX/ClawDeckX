import React, { useState, useCallback, useMemo } from 'react';
import { Language } from '../../types';
import { getTranslation } from '../../locales';
import { multiAgentApi, MultiAgentDeployRequest, MultiAgentDeployResult } from '../../services/api';
import { MultiAgentTemplate } from '../../services/template-system';
import { useToast } from '../Toast';

interface MultiAgentDeployWizardProps {
  template: MultiAgentTemplate;
  language: Language;
  onClose: () => void;
  onDeployed?: (result: MultiAgentDeployResult) => void;
}

type WizardStep = 'preview' | 'configure' | 'deploying' | 'result';

const MultiAgentDeployWizard: React.FC<MultiAgentDeployWizardProps> = ({
  template,
  language,
  onClose,
  onDeployed,
}) => {
  const t = useMemo(() => getTranslation(language) as any, [language]);
  const ma = (t.multiAgent || {}) as any;
  const md = (t.multiAgentDeploy || {}) as any;
  const { toast } = useToast();

  const [step, setStep] = useState<WizardStep>('preview');
  const [prefix, setPrefix] = useState(template.id);
  const [skipExisting, setSkipExisting] = useState(true);
  const [previewResult, setPreviewResult] = useState<MultiAgentDeployResult | null>(null);
  const [deployResult, setDeployResult] = useState<MultiAgentDeployResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Build deployment request
  const buildDeployRequest = useCallback((): MultiAgentDeployRequest => {
    return {
      template: {
        id: template.id,
        name: template.metadata.name,
        description: template.metadata.description,
        agents: template.content.agents.map(agent => ({
          id: agent.id,
          name: agent.name,
          role: agent.role,
          description: agent.description,
          icon: agent.icon,
          color: agent.color,
          soul: `# ${agent.name}\n\n**Role:** ${agent.role}\n\n${agent.description || ''}`,
          heartbeat: template.content.workflow.steps
            .filter(s => s.agent === agent.id || s.agents?.includes(agent.id))
            .map((s, i) => `- [ ] Step ${i + 1}: ${s.action}`)
            .join('\n'),
        })),
        workflow: template.content.workflow,
        bindings: [],
      },
      prefix,
      skipExisting,
      dryRun: false,
    };
  }, [template, prefix, skipExisting]);

  // Preview deployment
  const handlePreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const request = buildDeployRequest();
      request.dryRun = true;
      const result = await multiAgentApi.previewDeploy(request);
      setPreviewResult(result);
      setStep('configure');
    } catch (err: any) {
      setError(err?.message || 'Preview failed');
    } finally {
      setLoading(false);
    }
  }, [buildDeployRequest]);

  // Execute deployment
  const handleDeploy = useCallback(async () => {
    setStep('deploying');
    setLoading(true);
    setError(null);
    try {
      const request = buildDeployRequest();
      const result = await multiAgentApi.deploy(request);
      setDeployResult(result);
      setStep('result');
      if (result.success) {
        toast('success', `${md.deploySuccess || 'Deployment successful'} (${result.deployedCount} agents)`);
        onDeployed?.(result);
      }
    } catch (err: any) {
      setError(err?.message || 'Deployment failed');
      setStep('configure');
    } finally {
      setLoading(false);
    }
  }, [buildDeployRequest, md, toast, onDeployed]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'created': return 'bg-green-500/10 text-green-600 dark:text-green-400';
      case 'skipped': return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
      case 'failed': return 'bg-red-500/10 text-red-600 dark:text-red-400';
      case 'preview': return 'bg-blue-500/10 text-blue-600 dark:text-blue-400';
      default: return 'bg-slate-500/10 text-slate-600 dark:text-slate-400';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'created': return md.statusCreated || 'Created';
      case 'skipped': return md.statusSkipped || 'Skipped';
      case 'failed': return md.statusFailed || 'Failed';
      case 'preview': return md.statusPreview || 'Will Create';
      default: return status;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-2xl mx-4 rounded-2xl bg-white dark:bg-[#1a1a2e] border border-slate-200 dark:border-white/10 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${template.metadata.color || 'from-purple-500 to-pink-500'} flex items-center justify-center`}>
              <span className="material-symbols-outlined text-white text-[20px]">{template.metadata.icon || 'groups'}</span>
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800 dark:text-white">
                {md.title || 'Deploy Multi-Agent System'}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-white/40">{template.metadata.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 flex items-center justify-center"
          >
            <span className="material-symbols-outlined text-[18px] text-slate-400">close</span>
          </button>
        </div>

        {/* Progress Steps */}
        <div className="px-6 py-3 border-b border-slate-100 dark:border-white/5 flex items-center gap-2">
          {(['preview', 'configure', 'deploying', 'result'] as WizardStep[]).map((s, idx) => (
            <React.Fragment key={s}>
              <div className={`flex items-center gap-1.5 ${step === s ? 'text-primary' : 'text-slate-400 dark:text-white/30'}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  step === s ? 'bg-primary text-white' : 
                  (['preview', 'configure', 'deploying', 'result'].indexOf(step) > idx) ? 'bg-green-500 text-white' : 
                  'bg-slate-200 dark:bg-white/10'
                }`}>
                  {(['preview', 'configure', 'deploying', 'result'].indexOf(step) > idx) ? '✓' : idx + 1}
                </div>
                <span className="text-[10px] font-medium hidden sm:inline">
                  {s === 'preview' && (md.stepPreview || 'Preview')}
                  {s === 'configure' && (md.stepConfigure || 'Configure')}
                  {s === 'deploying' && (md.stepDeploying || 'Deploying')}
                  {s === 'result' && (md.stepResult || 'Result')}
                </span>
              </div>
              {idx < 3 && <div className="flex-1 h-0.5 bg-slate-200 dark:bg-white/10" />}
            </React.Fragment>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 max-h-[60vh] overflow-y-auto">
          {error && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-[11px] text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Step: Preview */}
          {step === 'preview' && (
            <div className="space-y-4">
              <p className="text-[12px] text-slate-600 dark:text-white/60">
                {md.previewDesc || 'This will create multiple independent AI agents with their own workspaces and configurations.'}
              </p>

              <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
                <div className="px-4 py-2 bg-slate-50 dark:bg-white/[0.02] border-b border-slate-200 dark:border-white/10">
                  <h4 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase">
                    {md.agentsToCreate || 'Agents to Create'} ({template.content.agents.length})
                  </h4>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-white/5">
                  {template.content.agents.map((agent) => (
                    <div key={agent.id} className="px-4 py-3 flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl ${agent.color || 'bg-slate-500'} flex items-center justify-center shrink-0`}>
                        <span className="material-symbols-outlined text-white text-[18px]">{agent.icon || 'person'}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-bold text-slate-700 dark:text-white/80">{agent.name}</p>
                        <p className="text-[10px] text-slate-500 dark:text-white/40">{agent.role}</p>
                      </div>
                      <div className="text-[10px] text-slate-400 dark:text-white/30 font-mono">
                        {prefix}-{agent.id}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-white/10 p-4">
                <h4 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase mb-3">
                  {md.workflowType || 'Workflow Type'}
                </h4>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded text-[10px] font-bold ${
                    template.content.workflow.type === 'sequential' ? 'bg-blue-500/10 text-blue-600' :
                    template.content.workflow.type === 'parallel' ? 'bg-green-500/10 text-green-600' :
                    template.content.workflow.type === 'collaborative' ? 'bg-purple-500/10 text-purple-600' :
                    'bg-amber-500/10 text-amber-600'
                  }`}>
                    {template.content.workflow.type}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-white/40">
                    {template.content.workflow.steps.length} {md.steps || 'steps'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Step: Configure */}
          {step === 'configure' && (
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase block mb-1.5">
                  {md.prefixLabel || 'Agent ID Prefix'}
                </label>
                <input
                  type="text"
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value.replace(/[^a-z0-9-]/gi, '').toLowerCase())}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-[12px] text-slate-800 dark:text-white/80 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  placeholder="my-team"
                />
                <p className="text-[10px] text-slate-400 dark:text-white/30 mt-1">
                  {md.prefixHint || 'Agents will be named: prefix-agentId (e.g., my-team-researcher)'}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="skipExisting"
                  checked={skipExisting}
                  onChange={(e) => setSkipExisting(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 dark:border-white/20 text-primary focus:ring-primary/30"
                />
                <label htmlFor="skipExisting" className="text-[11px] text-slate-600 dark:text-white/60">
                  {md.skipExisting || 'Skip if agent already exists'}
                </label>
              </div>

              {previewResult && (
                <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
                  <div className="px-4 py-2 bg-slate-50 dark:bg-white/[0.02] border-b border-slate-200 dark:border-white/10">
                    <h4 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase">
                      {md.deploymentPreview || 'Deployment Preview'}
                    </h4>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-white/5">
                    {previewResult.agents.map((agent) => (
                      <div key={agent.id} className="px-4 py-2.5 flex items-center justify-between">
                        <div>
                          <p className="text-[11px] font-semibold text-slate-700 dark:text-white/70">{agent.name}</p>
                          <p className="text-[10px] text-slate-400 dark:text-white/30 font-mono">{agent.id}</p>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${getStatusColor(agent.status)}`}>
                          {getStatusLabel(agent.status)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step: Deploying */}
          {step === 'deploying' && (
            <div className="py-12 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="material-symbols-outlined text-[32px] text-primary animate-spin">progress_activity</span>
              </div>
              <p className="text-[14px] font-bold text-slate-700 dark:text-white/80">
                {md.deployingTitle || 'Creating Agents...'}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-white/40 mt-1">
                {md.deployingDesc || 'Setting up workspaces and configurations'}
              </p>
            </div>
          )}

          {/* Step: Result */}
          {step === 'result' && deployResult && (
            <div className="space-y-4">
              <div className={`p-4 rounded-xl ${deployResult.success ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
                <div className="flex items-center gap-2">
                  <span className={`material-symbols-outlined text-[20px] ${deployResult.success ? 'text-green-600' : 'text-red-600'}`}>
                    {deployResult.success ? 'check_circle' : 'error'}
                  </span>
                  <p className={`text-[13px] font-bold ${deployResult.success ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                    {deployResult.success ? (md.deploySuccess || 'Deployment Successful') : (md.deployFailed || 'Deployment Failed')}
                  </p>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-white/50 mt-1 ml-7">
                  {deployResult.deployedCount} {md.created || 'created'}, {deployResult.skippedCount} {md.skipped || 'skipped'}
                </p>
              </div>

              {/* Coordinator Configuration Status */}
              <div className={`p-3 rounded-xl ${deployResult.coordinatorUpdated ? 'bg-blue-500/10 border border-blue-500/20' : 'bg-amber-500/10 border border-amber-500/20'}`}>
                <div className="flex items-center gap-2">
                  <span className={`material-symbols-outlined text-[18px] ${deployResult.coordinatorUpdated ? 'text-blue-600' : 'text-amber-600'}`}>
                    {deployResult.coordinatorUpdated ? 'check_circle' : 'warning'}
                  </span>
                  <div className="flex-1">
                    <p className={`text-[12px] font-bold ${deployResult.coordinatorUpdated ? 'text-blue-700 dark:text-blue-400' : 'text-amber-700 dark:text-amber-400'}`}>
                      {deployResult.coordinatorUpdated 
                        ? (md.coordinatorUpdated || 'Main agent configured')
                        : (md.coordinatorNotUpdated || 'Main agent not configured')}
                    </p>
                    {deployResult.coordinatorUpdated ? (
                      <p className="text-[10px] text-blue-600 dark:text-blue-400/70 mt-0.5">
                        {md.coordinatorUpdatedDesc || 'SOUL.md has been updated with subagent orchestration info'}
                      </p>
                    ) : (
                      <p className="text-[10px] text-amber-600 dark:text-amber-400/70 mt-0.5">
                        {deployResult.coordinatorError || (md.coordinatorNotUpdatedDesc || 'Please manually configure the main agent')}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Next Steps Guide - Only show on success */}
              {deployResult.success && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <h4 className="text-[12px] font-bold text-primary mb-2">
                    {ma.nextStepsTitle || '🎉 Deployment Successful! Next Steps'}
                  </h4>
                  <p className="text-[11px] text-slate-600 dark:text-white/60 mb-3">
                    {ma.nextStepsDesc || 'Subagents have been created and the main agent has been configured. Now you can:'}
                  </p>
                  <ul className="space-y-2">
                    <li className="flex items-start gap-2 text-[11px] text-slate-700 dark:text-white/70">
                      <span className="material-symbols-outlined text-[14px] text-green-500 shrink-0 mt-0.5">check_circle</span>
                      {ma.nextStep1 || 'Send tasks to the main agent, it will automatically call appropriate subagents'}
                    </li>
                    <li className="flex items-start gap-2 text-[11px] text-slate-700 dark:text-white/70">
                      <span className="material-symbols-outlined text-[14px] text-green-500 shrink-0 mt-0.5">check_circle</span>
                      {ma.nextStep2 || 'Use /subagents command to check subagent status'}
                    </li>
                    <li className="flex items-start gap-2 text-[11px] text-slate-700 dark:text-white/70">
                      <span className="material-symbols-outlined text-[14px] text-green-500 shrink-0 mt-0.5">check_circle</span>
                      {ma.nextStep3 || 'Directly @mention a subagent name in chat to talk to a specific subagent'}
                    </li>
                  </ul>
                  <div className="mt-3 pt-3 border-t border-primary/10">
                    <p className="text-[10px] text-primary/80">
                      {ma.nextStepsTip || '💡 Tip: The main agent has learned how to use the sessions_spawn tool to call subagents'}
                    </p>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
                <div className="px-4 py-2 bg-slate-50 dark:bg-white/[0.02] border-b border-slate-200 dark:border-white/10">
                  <h4 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase">
                    {md.agentStatus || 'Agent Status'}
                  </h4>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-white/5">
                  {deployResult.agents.map((agent) => (
                    <div key={agent.id} className="px-4 py-2.5 flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-semibold text-slate-700 dark:text-white/70">{agent.name}</p>
                        <p className="text-[10px] text-slate-400 dark:text-white/30 font-mono truncate">{agent.workspace || agent.id}</p>
                        {agent.error && (
                          <p className="text-[10px] text-red-500 mt-0.5">{agent.error}</p>
                        )}
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold shrink-0 ${getStatusColor(agent.status)}`}>
                        {getStatusLabel(agent.status)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {deployResult.errors && deployResult.errors.length > 0 && (
                <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/5 p-3">
                  <h4 className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase mb-2">
                    {md.errors || 'Errors'}
                  </h4>
                  <ul className="space-y-1">
                    {deployResult.errors.map((err, idx) => (
                      <li key={idx} className="text-[10px] text-red-600 dark:text-red-400">• {err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[11px] font-bold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/5"
          >
            {step === 'result' ? (md.close || 'Close') : (md.cancel || 'Cancel')}
          </button>

          <div className="flex items-center gap-2">
            {step === 'configure' && (
              <button
                onClick={() => setStep('preview')}
                className="px-4 py-2 rounded-lg text-[11px] font-bold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/5"
              >
                {md.back || 'Back'}
              </button>
            )}

            {step === 'preview' && (
              <button
                onClick={handlePreview}
                disabled={loading}
                className="px-4 py-2 rounded-lg text-[11px] font-bold bg-primary text-white hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
              >
                {loading && <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>}
                {md.continue || 'Continue'}
              </button>
            )}

            {step === 'configure' && (
              <button
                onClick={handleDeploy}
                disabled={loading || !prefix.trim()}
                className="px-4 py-2 rounded-lg text-[11px] font-bold bg-primary text-white hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[14px]">rocket_launch</span>
                {md.deploy || 'Deploy'}
              </button>
            )}

            {step === 'result' && deployResult?.success && (
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-[11px] font-bold bg-primary text-white hover:bg-primary/90 flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[14px]">check</span>
                {md.done || 'Done'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MultiAgentDeployWizard;
