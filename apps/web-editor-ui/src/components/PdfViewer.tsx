import { useState } from 'react';
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

// ─── Utilities ────────────────────────────────────────────────────────────────

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

// ─── Mock PDF Placeholder ─────────────────────────────────────────────────────
// Renders an A4-like document skeleton when the real PDF is not yet available.
// Remove this component once the backend returns a real pdfUrl.

const CONTENT_LINE_WIDTHS = [
  100, 92, 100, 78, 100, 88, 100, 65, 100, 95, 82, 100, 74, 100,
];

const MockPdfDocument: React.FC<{ projectName: string }> = ({
  projectName,
}) => (
  <div
    className="bg-white shadow-2xl flex-shrink-0"
    style={{ width: '595px', minHeight: '842px' }}
    aria-label="Aperçu du document compilé"
  >
    {/* Header area */}
    <div className="px-20 pt-16 pb-10">
      <div className="text-center mb-10 space-y-2">
        <div className="h-5 w-72 bg-slate-300 rounded mx-auto" />
        <div className="h-3 w-36 bg-slate-200 rounded mx-auto" />
        <div className="h-3 w-44 bg-slate-200 rounded mx-auto" />
      </div>

      {/* Abstract-like block */}
      <div className="border border-slate-100 rounded px-6 py-5 mb-8 space-y-1.5">
        <div className="h-2.5 w-20 bg-slate-300 rounded mb-3" />
        {[88, 100, 93, 76].map((w, i) => (
          <div
            key={i}
            className="h-2 rounded bg-slate-100"
            style={{ width: `${w}%` }}
          />
        ))}
      </div>

      {/* Section 1 */}
      <div className="mb-6">
        <div className="h-3.5 w-40 bg-slate-300 rounded mb-4" />
        <div className="space-y-1.5">
          {CONTENT_LINE_WIDTHS.map((w, i) => (
            <div
              key={i}
              className="h-2 rounded"
              style={{ width: `${w}%`, backgroundColor: '#e2e8f0' }}
            />
          ))}
        </div>
      </div>

      {/* Section 2 */}
      <div className="mb-6">
        <div className="h-3.5 w-52 bg-slate-300 rounded mb-4" />
        <div className="space-y-1.5">
          {[100, 85, 100, 90, 100, 72].map((w, i) => (
            <div
              key={i}
              className="h-2 rounded"
              style={{ width: `${w}%`, backgroundColor: '#e2e8f0' }}
            />
          ))}
        </div>
      </div>
    </div>

    {/* Footer */}
    <div className="px-20 pb-8 mt-auto">
      <div className="border-t border-slate-200 pt-4 flex justify-between items-center">
        <span className="text-[10px] text-slate-400">{projectName}</span>
        <span className="text-[10px] text-slate-400">1</span>
      </div>
    </div>
  </div>
);

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
}

const PdfViewer: React.FC<PdfViewerProps> = ({
  status,
  pdfUrl,
  projectName,
  compiledAt,
  durationMs,
  onRecompile,
  onClose,
}) => {
  const [zoom, setZoom] = useState(100);

  return (
    <div className="flex flex-col h-full bg-slate-200">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-white border-b border-slate-200 flex-shrink-0">
        {/* Left: title */}
        <span className="text-xs font-semibold text-slate-600 truncate max-w-[140px]">
          Aperçu PDF
        </span>

        {/* Center: zoom (only visible when PDF is rendered) */}
        {status === 'success' && (
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

      {/* ── Content area ── */}
      <div className="flex-1 overflow-auto flex items-start justify-center py-6 px-4">
        {status === 'idle' && <IdleScreen onCompile={onRecompile} />}
        {status === 'compiling' && <CompilingScreen />}
        {status === 'error' && <ErrorScreen onRecompile={onRecompile} />}

        {status === 'success' && (
          <div
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'top center',
              // Compensate layout shift from scale so the container still scrolls correctly
              marginBottom: `${(zoom / 100 - 1) * 842}px`,
            }}
          >
            {pdfUrl ? (
              <iframe
                src={pdfUrl}
                title="Aperçu PDF"
                className="shadow-2xl bg-white"
                style={{ width: '595px', height: '842px', border: 'none' }}
              />
            ) : (
              <MockPdfDocument projectName={projectName} />
            )}
          </div>
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
