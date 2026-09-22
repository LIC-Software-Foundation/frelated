import { lazy, Suspense, useState } from 'react';

const PdfDocument = lazy(() => import('./PdfDocument'));
import {
  AlertCircle,
  Download,
  FileText,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { CompilationStatus } from '../types';
import type { PdfSyncTargetPosition } from '@frelated/types';

// ─── Utilities ────────────────────────────────────────────────────────────────

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

// ─── State screens ────────────────────────────────────────────────────────────

const IdleScreen: React.FC<{ onCompile: () => void }> = ({ onCompile }) => (
  <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-4">
    <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center">
      <FileText className="w-8 h-8 text-slate-300" />
    </div>
    <div className="text-center">
      <p className="text-sm font-medium text-slate-600">Aucun PDF disponible</p>
      <p className="text-xs text-slate-400 mt-1">
        Lancez la compilation pour générer un aperçu.
      </p>
    </div>
    <button
      onClick={onCompile}
      className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-colors"
    >
      <RefreshCw className="w-4 h-4" />
      Compiler maintenant
    </button>
  </div>
);

const CompilingScreen: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-500">
    <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
    <div className="text-center">
      <p className="text-sm font-medium text-slate-600">
        Compilation en cours…
      </p>
      <p className="text-xs text-slate-400 mt-1">
        pdfLaTeX traite votre document
      </p>
    </div>
  </div>
);

const ErrorScreen: React.FC<{ onRecompile: () => void }> = ({
  onRecompile,
}) => (
  <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-500">
    <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center">
      <AlertCircle className="w-7 h-7 text-red-400" />
    </div>
    <div className="text-center">
      <p className="text-sm font-semibold text-slate-700">
        Échec de compilation
      </p>
      <p className="text-xs text-slate-400 mt-1 max-w-xs">
        Le compilateur a rencontré des erreurs. Consultez les logs pour les
        corriger.
      </p>
    </div>
    <button
      onClick={onRecompile}
      className="flex items-center gap-2 px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm rounded-lg transition-colors"
    >
      <RefreshCw className="w-4 h-4" />
      Recompiler
    </button>
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────

interface PdfViewerProps {
  status: CompilationStatus;
  pdfUrl?: string;
  projectName: string;
  compiledAt?: string;
  durationMs?: number;
  onRecompile: () => void;
  onClose: () => void;
  syncTarget?: PdfSyncTargetPosition;
  onSyncToSource?: (position: { page: number; x: number; y: number }) => void;
  isStale?: boolean;
}

const PdfViewer: React.FC<PdfViewerProps> = ({
  status,
  pdfUrl,
  projectName,
  compiledAt,
  durationMs,
  onRecompile,
  onClose,
  syncTarget,
  onSyncToSource,
  isStale,
}) => {
  const [zoom, setZoom] = useState(147);

  return (
    <div className="flex flex-col h-full bg-slate-200">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-white border-b border-slate-200 flex-shrink-0">
        {/* Left: title */}
        <span className="text-xs font-semibold text-slate-600 truncate max-w-[140px]">
          Aperçu PDF
        </span>

        {/* Center: zoom (only visible when PDF is rendered) */}
        {pdfUrl && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setZoom((z) => Math.max(50, z - 10))}
              className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
              title="Zoom arrière"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs text-slate-500 tabular-nums w-10 text-center">
              {zoom}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(200, z + 10))}
              className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
              title="Zoom avant"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Right: actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={onRecompile}
            disabled={status === 'compiling'}
            className="flex items-center gap-1.5 px-2 py-1 text-xs rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 disabled:opacity-40 transition-colors"
            title="Recompiler"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${status === 'compiling' ? 'animate-spin' : ''}`}
            />
          </button>

          {pdfUrl && (
            <a
              href={pdfUrl}
              download={`${projectName}.pdf`}
              className="flex items-center gap-1.5 px-2 py-1 text-xs rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
              title="Télécharger le PDF"
            >
              <Download className="w-3.5 h-3.5" />
            </a>
          )}

          <div className="w-px h-4 bg-slate-200 mx-0.5" />

          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            title="Fermer l'aperçu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {pdfUrl && status === 'compiling' && (
        <p role="status" className="px-3 py-1 text-xs text-slate-600">
          Compilation en cours… Dernier PDF réussi affiché.
        </p>
      )}
      {pdfUrl && status === 'error' && (
        <p role="alert" className="px-3 py-1 text-xs text-red-700">
          Échec de compilation. Dernier PDF réussi conservé ; consultez les
          logs.
        </p>
      )}
      {syncTarget?.stale && (
        <p role="status" className="px-3 py-1 text-xs text-amber-700">
          Position issue de la dernière compilation réussie.
        </p>
      )}
      {isStale && !syncTarget?.stale && (
        <p role="status" className="px-3 py-1 text-xs text-amber-700">
          Le document a changé depuis cette compilation.
        </p>
      )}
      {/* ── Content area ── */}
      <div className="flex-1 min-h-0 overflow-auto flex items-start justify-center">
        {status === 'idle' && !pdfUrl && <IdleScreen onCompile={onRecompile} />}
        {status === 'compiling' && !pdfUrl && <CompilingScreen />}
        {status === 'error' && !pdfUrl && (
          <ErrorScreen onRecompile={onRecompile} />
        )}

        {pdfUrl && (
          <Suspense
            fallback={
              <p role="status" className="p-4 text-sm text-slate-500">
                Chargement du PDF…
              </p>
            }
          >
            <PdfDocument
              url={pdfUrl}
              zoom={zoom}
              syncTarget={syncTarget}
              onSyncToSource={onSyncToSource}
            />
          </Suspense>
        )}
      </div>

      {/* ── Status bar ── */}
      {(status === 'success' || status === 'error') &&
        compiledAt !== undefined && (
          <div className="flex items-center justify-between px-3 py-1 bg-white border-t border-slate-200 text-[10px] text-slate-400 flex-shrink-0">
            <span>
              Compilé à {formatTime(compiledAt)}
              {durationMs !== undefined &&
                ` · ${(durationMs / 1000).toFixed(1)}s`}
            </span>
            <span
              className={
                status === 'success' ? 'text-emerald-500' : 'text-red-400'
              }
            >
              {status === 'success' ? '✓ Succès' : '✗ Erreur'}
            </span>
          </div>
        )}
    </div>
  );
};

export default PdfViewer;
