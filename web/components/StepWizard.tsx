
import React, { useState, useCallback } from 'react';

export interface WizardStep {
  id: string;
  icon: string;
  title: string;
  subtitle?: string;
}

interface StepWizardProps {
  steps: WizardStep[];
  currentStep: number;
  onStepChange: (step: number) => void;
  children: React.ReactNode;
  onFinish?: () => void;
  finishLabel?: string;
  nextLabel?: string;
  prevLabel?: string;
  canNext?: boolean;
  loading?: boolean;
  hideNav?: boolean;
}

const StepWizard: React.FC<StepWizardProps> = ({
  steps,
  currentStep,
  onStepChange,
  children,
  onFinish,
  finishLabel = 'Finish',
  nextLabel = 'Next',
  prevLabel = 'Back',
  canNext = true,
  loading = false,
  hideNav = false,
}) => {
  const isFirst = currentStep === 0;
  const isLast = currentStep === steps.length - 1;

  return (
    <div className="flex flex-col h-full">
      {/* Stepper Bar */}
      <div className="flex-shrink-0 px-3 sm:px-6 pt-4 pb-2">
        <div className="flex items-center justify-center gap-1 sm:gap-2 overflow-x-auto">
          {steps.map((step, i) => {
            const done = i < currentStep;
            const active = i === currentStep;
            return (
              <React.Fragment key={step.id}>
                {i > 0 && (
                  <div className={`hidden sm:block w-6 md:w-10 h-px transition-colors ${done ? 'bg-green-400' : 'bg-slate-200 dark:bg-white/10'}`} />
                )}
                <button
                  onClick={() => done && onStepChange(i)}
                  disabled={!done}
                  className={`flex items-center gap-1.5 px-2 py-1.5 sm:px-3 sm:py-2 rounded-xl transition-all text-left min-w-0 ${active
                      ? 'bg-primary/10 dark:bg-primary/20 ring-1 ring-primary/40'
                      : done
                        ? 'hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer'
                        : 'opacity-40 cursor-default'
                    }`}
                >
                  <span className={`material-symbols-outlined text-sm flex-shrink-0 ${done ? 'text-green-500' : active ? 'text-primary' : 'text-slate-400 dark:text-white/40'
                    }`}>
                    {done ? 'check_circle' : step.icon}
                  </span>
                  <span className={`text-[11px] sm:text-xs font-medium truncate ${active ? 'text-slate-800 dark:text-white/90' : 'text-slate-500 dark:text-white/50'
                    }`}>
                    {step.title}
                  </span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Step Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-3 sm:px-6 py-3 sm:py-4">
        {children}
      </div>

      {/* Navigation */}
      {!hideNav && (
        <div className="flex-shrink-0 px-3 sm:px-6 py-3 border-t border-slate-200 dark:border-white/10 flex items-center justify-between gap-3">
          <button
            onClick={() => onStepChange(currentStep - 1)}
            disabled={isFirst}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium transition-all ${isFirst
                ? 'opacity-0 pointer-events-none'
                : 'text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/5'
              }`}
          >
            <span className="material-symbols-outlined text-sm">chevron_left</span>
            {prevLabel}
          </button>

          <div className="text-[10px] text-slate-400 dark:text-white/40">
            {currentStep + 1} / {steps.length}
          </div>

          {isLast ? (
            <button
              onClick={onFinish}
              disabled={!canNext || loading}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-medium bg-green-500 hover:bg-green-600 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>}
              {finishLabel}
              <span className="material-symbols-outlined text-sm">check</span>
            </button>
          ) : (
            <button
              onClick={() => onStepChange(currentStep + 1)}
              disabled={!canNext}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-medium bg-primary hover:bg-primary/90 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {nextLabel}
              <span className="material-symbols-outlined text-sm">chevron_right</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default StepWizard;

export const TipBox: React.FC<{ icon?: string; children: React.ReactNode; variant?: 'info' | 'warn' | 'success' }> = ({
  icon, children, variant = 'info'
}) => {
  const styles = {
    info: 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20 text-blue-700 dark:text-blue-400',
    warn: 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400',
    success: 'bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/20 text-green-700 dark:text-green-400',
  };
  return (
    <div className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${styles[variant]}`}>
      {icon && <span className="material-symbols-outlined text-sm flex-shrink-0 mt-0.5">{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  );
};

export const StepCard: React.FC<{ title: string; subtitle?: string; icon?: string; children: React.ReactNode }> = ({
  title, subtitle, icon, children
}) => (
  <div className="space-y-4">
    <div className="flex items-center gap-2.5">
      {icon && <span className="material-symbols-outlined text-lg text-primary">{icon}</span>}
      <div>
        <h3 className="text-sm font-bold text-slate-800 dark:text-white/90">{title}</h3>
        {subtitle && <p className="text-[11px] text-slate-500 dark:text-white/50 mt-0.5">{subtitle}</p>}
      </div>
    </div>
    {children}
  </div>
);
