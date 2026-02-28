import React, { useMemo } from 'react';
import { Language } from '../../types';
import { getTranslation } from '../../locales';

interface Agent {
  id: string;
  name: string;
  role?: string;
  icon?: string;
  color?: string;
}

interface WorkflowStep {
  agent?: string;
  agents?: string[];
  action: string;
  parallel?: boolean;
  condition?: string;
}

interface Workflow {
  type: 'sequential' | 'parallel' | 'collaborative' | 'event-driven' | 'routing';
  description?: string;
  steps: WorkflowStep[];
}

interface WorkflowVisualizerProps {
  agents: Agent[];
  workflow: Workflow;
  language: Language;
  activeStepIndex?: number;
  runningAgentIds?: string[];
  compact?: boolean;
}

const WorkflowVisualizer: React.FC<WorkflowVisualizerProps> = ({
  agents,
  workflow,
  language,
  activeStepIndex = -1,
  runningAgentIds = [],
  compact = false,
}) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const ma = (t as any).multiAgent || {};

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    agents.forEach(a => map.set(a.id, a));
    return map;
  }, [agents]);

  const getAgentPosition = (agentId: string, totalAgents: number, index: number) => {
    const angle = (index / totalAgents) * 2 * Math.PI - Math.PI / 2;
    const radius = compact ? 80 : 120;
    return {
      x: 150 + radius * Math.cos(angle),
      y: 150 + radius * Math.sin(angle),
    };
  };

  const agentPositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    agents.forEach((agent, idx) => {
      positions.set(agent.id, getAgentPosition(agent.id, agents.length, idx));
    });
    return positions;
  }, [agents, compact]);

  const connections = useMemo(() => {
    const conns: Array<{
      from: string;
      to: string;
      stepIndex: number;
      parallel?: boolean;
    }> = [];

    workflow.steps.forEach((step, idx) => {
      const stepAgents = step.agents || (step.agent ? [step.agent] : []);
      
      if (workflow.type === 'sequential' && idx > 0) {
        const prevStep = workflow.steps[idx - 1];
        const prevAgents = prevStep.agents || (prevStep.agent ? [prevStep.agent] : []);
        
        prevAgents.forEach(fromId => {
          stepAgents.forEach(toId => {
            if (fromId !== toId) {
              conns.push({ from: fromId, to: toId, stepIndex: idx });
            }
          });
        });
      } else if (workflow.type === 'parallel' || step.parallel) {
        // Parallel: all agents connect to center
      } else if (workflow.type === 'collaborative') {
        // Collaborative: mesh connections
        for (let i = 0; i < stepAgents.length; i++) {
          for (let j = i + 1; j < stepAgents.length; j++) {
            conns.push({ from: stepAgents[i], to: stepAgents[j], stepIndex: idx, parallel: true });
          }
        }
      }
    });

    return conns;
  }, [workflow]);

  const renderConnection = (conn: { from: string; to: string; stepIndex: number; parallel?: boolean }, idx: number) => {
    const fromPos = agentPositions.get(conn.from);
    const toPos = agentPositions.get(conn.to);
    if (!fromPos || !toPos) return null;

    const isActive = activeStepIndex === conn.stepIndex;
    const midX = (fromPos.x + toPos.x) / 2;
    const midY = (fromPos.y + toPos.y) / 2;

    // Calculate control point for curved line
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const cx = midX - dy * 0.2;
    const cy = midY + dx * 0.2;

    return (
      <g key={`conn-${idx}`}>
        <path
          d={`M ${fromPos.x} ${fromPos.y} Q ${cx} ${cy} ${toPos.x} ${toPos.y}`}
          fill="none"
          stroke={isActive ? '#6366f1' : conn.parallel ? '#22c55e' : '#94a3b8'}
          strokeWidth={isActive ? 2.5 : 1.5}
          strokeDasharray={conn.parallel ? '4 2' : undefined}
          className={isActive ? 'animate-pulse' : ''}
          markerEnd={conn.parallel ? undefined : 'url(#arrowhead)'}
        />
        {/* Step number */}
        <circle cx={midX} cy={midY} r={8} fill={isActive ? '#6366f1' : '#e2e8f0'} className="dark:fill-slate-700" />
        <text x={midX} y={midY + 3} textAnchor="middle" fontSize={8} fill={isActive ? 'white' : '#64748b'} fontWeight="bold">
          {conn.stepIndex + 1}
        </text>
      </g>
    );
  };

  const renderAgent = (agent: Agent, idx: number) => {
    const pos = agentPositions.get(agent.id);
    if (!pos) return null;

    const isRunning = runningAgentIds.includes(agent.id);
    const size = compact ? 36 : 48;
    const halfSize = size / 2;

    return (
      <g key={agent.id} transform={`translate(${pos.x - halfSize}, ${pos.y - halfSize})`}>
        {/* Glow effect for running agents */}
        {isRunning && (
          <circle
            cx={halfSize}
            cy={halfSize}
            r={halfSize + 8}
            fill="none"
            stroke="#6366f1"
            strokeWidth={2}
            className="animate-ping"
            opacity={0.5}
          />
        )}
        
        {/* Agent circle */}
        <rect
          x={0}
          y={0}
          width={size}
          height={size}
          rx={12}
          fill={agent.color || '#6366f1'}
          className={isRunning ? 'animate-pulse' : ''}
        />
        
        {/* Agent icon placeholder (using first letter) */}
        <text
          x={halfSize}
          y={halfSize + (compact ? 4 : 6)}
          textAnchor="middle"
          fontSize={compact ? 14 : 18}
          fill="white"
          fontWeight="bold"
        >
          {agent.name.charAt(0).toUpperCase()}
        </text>

        {/* Agent name */}
        <text
          x={halfSize}
          y={size + 14}
          textAnchor="middle"
          fontSize={compact ? 9 : 10}
          fill="currentColor"
          className="text-slate-700 dark:text-white/80"
          fontWeight="600"
        >
          {agent.name.length > 10 ? agent.name.slice(0, 10) + '...' : agent.name}
        </text>

        {/* Role */}
        {!compact && agent.role && (
          <text
            x={halfSize}
            y={size + 26}
            textAnchor="middle"
            fontSize={8}
            fill="currentColor"
            className="text-slate-400 dark:text-white/40"
          >
            {agent.role.length > 12 ? agent.role.slice(0, 12) + '...' : agent.role}
          </text>
        )}

        {/* Running indicator */}
        {isRunning && (
          <circle cx={size - 4} cy={4} r={5} fill="#22c55e" className="animate-pulse">
            <animate attributeName="r" values="4;6;4" dur="1s" repeatCount="indefinite" />
          </circle>
        )}
      </g>
    );
  };

  const renderWorkflowType = () => {
    const typeConfig: Record<string, { icon: string; color: string; label: string }> = {
      sequential: { icon: '→', color: '#3b82f6', label: ma.workflowSequential || 'Sequential' },
      parallel: { icon: '⇉', color: '#22c55e', label: ma.workflowParallel || 'Parallel' },
      collaborative: { icon: '⟷', color: '#a855f7', label: ma.workflowCollaborative || 'Collaborative' },
      'event-driven': { icon: '⚡', color: '#f97316', label: ma.workflowEventDriven || 'Event-Driven' },
      routing: { icon: '⤴', color: '#06b6d4', label: ma.workflowRouting || 'Routing' },
    };

    const config = typeConfig[workflow.type] || typeConfig.sequential;

    return (
      <g transform="translate(10, 10)">
        <rect x={0} y={0} width={80} height={24} rx={6} fill={config.color} opacity={0.15} />
        <text x={40} y={16} textAnchor="middle" fontSize={10} fill={config.color} fontWeight="bold">
          {config.icon} {config.label}
        </text>
      </g>
    );
  };

  const svgSize = compact ? 240 : 300;

  return (
    <div className="relative">
      <svg
        width="100%"
        height={svgSize}
        viewBox={`0 0 ${svgSize} ${svgSize}`}
        className="overflow-visible"
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
          </marker>
          <marker
            id="arrowhead-active"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#6366f1" />
          </marker>
        </defs>

        {/* Center hub for parallel/collaborative */}
        {(workflow.type === 'parallel' || workflow.type === 'collaborative') && (
          <circle
            cx={svgSize / 2}
            cy={svgSize / 2}
            r={20}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={2}
            strokeDasharray="4 2"
            className="dark:stroke-white/10"
          />
        )}

        {/* Connections */}
        {connections.map((conn, idx) => renderConnection(conn, idx))}

        {/* Agents */}
        {agents.map((agent, idx) => renderAgent(agent, idx))}

        {/* Workflow type badge */}
        {renderWorkflowType()}
      </svg>

      {/* Legend */}
      {!compact && (
        <div className="flex items-center justify-center gap-4 mt-2 text-[9px] text-slate-400 dark:text-white/30">
          <div className="flex items-center gap-1">
            <div className="w-3 h-0.5 bg-slate-400" />
            <span>{ma.legendSequential || 'Sequential'}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-0.5 bg-green-500" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 2px, #22c55e 2px, #22c55e 4px)' }} />
            <span>{ma.legendParallel || 'Parallel'}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span>{ma.legendRunning || 'Running'}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkflowVisualizer;
