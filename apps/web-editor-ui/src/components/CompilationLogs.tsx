import { useEffect, useRef } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Terminal,
  X,
} from 'lucide-react';
import { CompilationState, LogEntry, LogLevel } from '../types';

// ─── Sub-components ───────────────────────────────────────────────────────────

const levelConfig: Record<
  LogLevel,
  { icon: React.ReactNode; text: string; dim: string }
> = {
  error: {
    icon: (
      <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-[1px]" />
    ),
    text: 'text-red-300',
    dim: 'text-red-500',
  },
  warning: {
    icon: (
      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-[1px]" />
    ),
    text: 'text-amber-300',
    dim: 'text-amber-600',
  },
  info: {
    icon: <span className="w-3.5 h-3.5 flex-shrink-0" />,
    text: 'text-slate-400',
    dim: 'text-slate-600',
  },
};

const LogLine: React.FC<{ entry: LogEntry }> = ({ entry }) => {
  const cfg = levelConfig[entry.level];
  return (
    <div className="flex items-start gap-2 py-0.5">
      {cfg.icon}
      <div className="flex-1 min-w-0">
        <span className={`${cfg.text} break-all leading-relaxed`}>
          {entry.message}
        </span>
        {(entry.file ?? entry.line) && (
          <span className={`ml-2 ${cfg.dim} text-[10px] tabular-nums`}>
            {entry.file}
            {entry.line !== undefined ? `:${entry.line}` : ''}
          </span>
        )}
      </div>
    </div>
  );
};

const CompilingPlaceholder: React.FC = () => (
  <div className="flex items-center gap-3 text-slate-400 py-2">
    <Loader2 className="w-4 h-4 animate-spin text-emerald-500 flex-shrink-0" />
    <span>Compilation en cours…</span>
  </div>
);

const StatusBadge: React.FC<{ count: number; color: string }> = ({
  count,
  color,
}) =>
  count > 0 ? (
    <span
      className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded text-[10px] font-bold ${color}`}
    >
      {count}
    </span>
  ) : null;

// ─── Main component ───────────────────────────────────────────────────────────

interface CompilationLogsProps
  extends Pick<CompilationState, 'status' | 'logs' | 'durationMs'> {
  isOpen: boolean;
  onClose: () => void;
}

const CompilationLogs: React.FC<CompilationLogsProps> = ({
  status,
  logs,
  durationMs,
  isOpen,
  onClose,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  if (!isOpen) return null;

  const errorCount = logs.filter((l) => l.level === 'error').length;
  const warnCount = logs.filter((l) => l.level === 'warning').length;

  const statusIcon = {
    idle: <Terminal className="w-4 h-4 text-slate-500" />,
    compiling: <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />,
    success: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
    error: <AlertCircle className="w-4 h-4 text-red-400" />,
  }[status];

  const statusLabel = {
    idle: 'Aucune compilation',
    compiling: 'Compilation…',
    success: `Succès${durationMs !== undefined ? ` · ${(durationMs / 1000).toFixed(1)}s` : ''}`,
    error: `Échec${durationMs !== undefined ? ` · ${(durationMs / 1000).toFixed(1)}s` : ''}`,
  }[status];

  return (
    <div className="flex flex-col h-56 bg-slate-950 border-t border-slate-800 flex-shrink-0 animate-slide-up">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          {statusIcon}
          <span className="text-xs font-semibold text-slate-300">
            Logs de compilation
          </span>
          <span
            className={`text-xs ${
              status === 'error'
                ? 'text-red-400'
                : status === 'success'
                  ? 'text-emerald-400'
                  : 'text-slate-500'
            }`}
          >
            {statusLabel}
          </span>

          {/* Error / warning badges */}
          <div className="flex items-center gap-1 ml-1">
            <StatusBadge
              count={errorCount}
              color="bg-red-900/60 text-red-300"
            />
            <StatusBadge
              count={warnCount}
              color="bg-amber-900/60 text-amber-300"
            />
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-white/10 text-slate-500 hover:text-slate-300 transition-colors"
          aria-label="Fermer les logs"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Log entries ── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-2 sidebar-scroll font-mono text-xs leading-5"
      >
        {status === 'idle' && (
          <div className="flex items-center gap-2 text-slate-600 py-4">
            <Info className="w-4 h-4 flex-shrink-0" />
            <span>Lancez une compilation pour voir les logs ici.</span>
          </div>
        )}

        {status === 'compiling' && logs.length === 0 && (
          <CompilingPlaceholder />
        )}

        {logs.map((entry, i) => (
          <LogLine key={i} entry={entry} />
        ))}

        {status === 'compiling' && logs.length > 0 && <CompilingPlaceholder />}
      </div>
    </div>
  );
};

export default CompilationLogs;
