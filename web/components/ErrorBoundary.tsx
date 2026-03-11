import React, { Component, ErrorInfo } from 'react';
import { copyToClipboard } from '../utils/clipboard';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  windowId?: string;
  windowTitle?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    // Log to console for debugging
    console.error(`[ErrorBoundary] ${this.props.windowId || 'unknown'} crashed:`, error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  handleCopyError = () => {
    const { error, errorInfo } = this.state;
    const text = [
      `Window: ${this.props.windowId || 'unknown'}`,
      `Error: ${error?.message || 'Unknown error'}`,
      `Stack: ${error?.stack || ''}`,
      `Component Stack: ${errorInfo?.componentStack || ''}`,
    ].join('\n\n');
    copyToClipboard(text).catch(() => {});
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const { error } = this.state;
    const title = this.props.windowTitle || this.props.windowId || '';

    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-50/50 dark:bg-transparent select-text">
        <div className="max-w-md w-full text-center space-y-4">
          {/* Icon */}
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-red-400/20 to-amber-400/20 dark:from-red-500/10 dark:to-amber-500/10 border border-red-200/50 dark:border-red-500/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-[32px] text-red-400 dark:text-red-400/70">bug_report</span>
          </div>

          {/* Title */}
          <div>
            <h2 className="text-[15px] font-bold text-slate-700 dark:text-white/80">
              Something went wrong
            </h2>
            {title && (
              <p className="text-[11px] text-slate-400 dark:text-white/30 mt-0.5">
                {title}
              </p>
            )}
          </div>

          {/* Error message */}
          <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-500/[0.06] border border-red-200/50 dark:border-red-500/10 text-start">
            <p className="text-[11px] text-red-600 dark:text-red-400/80 font-mono break-all leading-relaxed">
              {error?.message || 'An unexpected error occurred'}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={this.handleRetry}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-[12px] font-bold hover:opacity-90 shadow-sm transition-all"
            >
              <span className="material-symbols-outlined text-[14px]">refresh</span>
              Retry
            </button>
            <button
              onClick={this.handleCopyError}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 text-[12px] font-bold hover:bg-slate-50 dark:hover:bg-white/5 transition-all"
            >
              <span className="material-symbols-outlined text-[14px]">content_copy</span>
              Copy Error
            </button>
          </div>

          {/* Hint */}
          <p className="text-[10px] text-slate-400 dark:text-white/25 leading-relaxed">
            This module crashed but other windows are unaffected.<br />
            Try clicking Retry, or close and reopen the window.
          </p>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
