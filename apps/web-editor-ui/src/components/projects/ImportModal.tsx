import { DragEvent, useRef, useState } from 'react';
import {
  X,
  UploadCloud,
  FileText,
  FolderOpen,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import { ImportResult } from '../../hooks/useProjects';
import { importProjectArchive } from '../../services/projectService';
import { Button } from '../ui';

interface ImportModalProps {
  onClose: () => void;
  onImport: (name: string, result: ImportResult) => void;
}

type Step = 'pick' | 'processing' | 'preview' | 'error';

const ImportModal: React.FC<ImportModalProps> = ({ onClose, onImport }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('pick');
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errMsg, setErrMsg] = useState('');

  const processFile = async (file: File) => {
    const base = file.name.replace(/\.(zip)$/i, '');
    setFileName(file.name);
    setProjectName(base);
    setStep('processing');
    try {
      const res = await importProjectArchive(file);
      setResult(res);
      setStep('preview');
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Erreur lors du traitement.');
      setStep('error');
    }
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) await processFile(file);
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await processFile(file);
  };

  const handleConfirm = () => {
    if (!result) return;
    onImport(projectName.trim() || fileName, result);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl shadow-black/20 overflow-hidden animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-[16px] font-bold text-slate-900">
              Importer un projet
            </h2>
            <p className="text-[12px] text-slate-500 mt-0.5">
              Archive ZIP contenant des fichiers .tex
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-lg hover:bg-slate-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {/* STEP: pick ─────────────────────────────────────────────── */}
          {step === 'pick' && (
            <div className="space-y-4">
              {/* Drop zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 cursor-pointer transition-all
                  ${dragging ? 'drop-zone-active' : 'border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50'}`}
              >
                <div
                  className={`h-12 w-12 rounded-2xl flex items-center justify-center transition-colors ${dragging ? 'bg-emerald-100' : 'bg-slate-100'}`}
                >
                  <UploadCloud
                    className={`h-6 w-6 ${dragging ? 'text-emerald-600' : 'text-slate-400'}`}
                  />
                </div>
                <div className="text-center">
                  <p className="text-[14px] font-semibold text-slate-700">
                    {dragging
                      ? 'Déposez le fichier ici'
                      : 'Glissez votre archive ZIP'}
                  </p>
                  <p className="text-[12px] text-slate-400 mt-1">
                    ou cliquez pour parcourir
                  </p>
                </div>
              </div>

              <input
                ref={fileRef}
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                className="hidden"
                onChange={onFileChange}
              />

              {/* Info box */}
              <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 flex gap-3">
                <FileText className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-[12px] text-blue-800 leading-relaxed">
                  La plateforme analysera l&apos;archive, détectera les fichiers{' '}
                  <strong>.tex</strong> et les indexera automatiquement dans
                  votre espace.
                </div>
              </div>
            </div>
          )}

          {/* STEP: processing ─────────────────────────────────────── */}
          {step === 'processing' && (
            <div className="flex flex-col items-center gap-5 py-10">
              <div className="relative">
                <div className="h-16 w-16 rounded-2xl bg-emerald-50 flex items-center justify-center">
                  <Loader2 className="h-7 w-7 text-emerald-600 animate-spin-slow" />
                </div>
              </div>
              <div className="text-center">
                <p className="text-[15px] font-semibold text-slate-900">
                  Analyse en cours…
                </p>
                <p className="text-[13px] text-slate-500 mt-1">{fileName}</p>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-emerald-500 h-full rounded-full animate-pulse"
                  style={{ width: '60%' }}
                />
              </div>
            </div>
          )}

          {/* STEP: preview ─────────────────────────────────────────── */}
          {step === 'preview' && result && (
            <div className="space-y-5">
              {/* Status banner */}
              <div
                className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${
                  result.hasTexFile
                    ? 'bg-emerald-50 border-emerald-100'
                    : 'bg-amber-50 border-amber-100'
                }`}
              >
                {result.hasTexFile ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0" />
                )}
                <div>
                  <p
                    className={`text-[13px] font-semibold ${result.hasTexFile ? 'text-emerald-800' : 'text-amber-800'}`}
                  >
                    {result.hasTexFile
                      ? 'Fichier(s) .tex détecté(s)'
                      : 'Aucun fichier .tex trouvé'}
                  </p>
                  <p className="text-[12px] text-slate-500 mt-0.5">
                    {result.files.length} fichier
                    {result.files.length !== 1 ? 's' : ''} détecté
                    {result.files.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>

              {/* File list preview */}
              <div className="max-h-36 overflow-y-auto space-y-1">
                {result.files.slice(0, 12).map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100"
                  >
                    <div
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${f.type === 'tex' ? 'bg-amber-400' : f.type === 'bib' ? 'bg-blue-400' : 'bg-slate-300'}`}
                    />
                    <span className="text-[12px] text-slate-600 font-mono truncate">
                      {f.name}
                    </span>
                    {f.type === 'tex' && (
                      <span className="ml-auto text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                        .tex
                      </span>
                    )}
                  </div>
                ))}
                {result.files.length > 12 && (
                  <p className="text-[11px] text-slate-400 text-center py-1">
                    + {result.files.length - 12} autres fichiers
                  </p>
                )}
              </div>

              {/* Project name */}
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1.5">
                  Nom du projet
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-3 flex items-center text-slate-400 pointer-events-none">
                    <FolderOpen className="h-4 w-4" />
                  </span>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="Nom du projet"
                    className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[#40916c] focus:ring-3 focus:ring-[#52b788]/20"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP: error ────────────────────────────────────────────── */}
          {step === 'error' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="h-14 w-14 rounded-2xl bg-red-50 flex items-center justify-center">
                <AlertTriangle className="h-7 w-7 text-red-500" />
              </div>
              <div className="text-center">
                <p className="text-[15px] font-semibold text-slate-900">
                  Erreur lors du traitement
                </p>
                <p className="text-[13px] text-slate-500 mt-1 max-w-xs">
                  {errMsg}
                </p>
              </div>
              <button
                onClick={() => setStep('pick')}
                className="text-[13px] text-emerald-600 font-medium hover:text-emerald-700 transition-colors"
              >
                Réessayer avec un autre fichier
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {(step === 'pick' || step === 'preview' || step === 'error') && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50/60">
            <button
              onClick={onClose}
              className="text-[13px] text-slate-500 hover:text-slate-700 transition-colors"
            >
              Annuler
            </button>
            {step === 'preview' && (
              <Button
                variant="primary"
                size="md"
                rightIcon={<ArrowRight className="h-4 w-4" />}
                onClick={handleConfirm}
              >
                Importer le projet
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ImportModal;
