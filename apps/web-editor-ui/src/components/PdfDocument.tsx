import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { PdfSyncTargetPosition } from '@frelated/types';
import { toPdfCoordinates } from './pdfCoordinates';

type LoadedPdf = { document: PDFDocumentProxy; sourceUrl: string };
const CSS_UNITS = 96 / 72;

/** Render PDF pages inside the application, without the browser PDF toolbar. */
export default function PdfDocument({
  url,
  zoom,
  syncTarget,
  onSyncToSource,
}: {
  url: string;
  zoom: number;
  syncTarget?: PdfSyncTargetPosition;
  onSyncToSource?: (position: { page: number; x: number; y: number }) => void;
}) {
  const pages = useRef<HTMLDivElement>(null);
  const scrollContainer = useRef<HTMLDivElement>(null);
  const preservedScrollRatio = useRef(0);
  const onSyncToSourceRef = useRef(onSyncToSource);
  const [pdf, setPdf] = useState<LoadedPdf>();
  const [error, setError] = useState(false);

  useEffect(() => {
    onSyncToSourceRef.current = onSyncToSource;
  }, [onSyncToSource]);

  useEffect(() => {
    let disposed = false;
    let loadingTask: ReturnType<(typeof import('pdfjs-dist'))['getDocument']>;
    let loadedDocument: PDFDocumentProxy | undefined;
    setPdf(undefined);
    setError(false);

    void (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const worker = await import(
        'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
      );
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`PDF HTTP ${response.status}`);
      loadingTask = pdfjs.getDocument({
        data: new Uint8Array(await response.arrayBuffer()),
        isEvalSupported: false,
      });
      loadedDocument = await loadingTask.promise;
      if (!disposed) setPdf({ document: loadedDocument, sourceUrl: url });
    })().catch((cause: unknown) => {
      if (!disposed) {
        console.error('PDF preview:', cause);
        setError(true);
      }
    });

    return () => {
      disposed = true;
      void loadingTask?.destroy();
      void loadedDocument?.destroy();
    };
  }, [url]);

  useEffect(() => {
    if (!pdf || pdf.sourceUrl !== url || !pages.current) return;
    let disposed = false;
    const renderTasks: RenderTask[] = [];
    const target = pages.current;
    const scroller = scrollContainer.current;
    target.replaceChildren();

    void (async () => {
      for (
        let pageNumber = 1;
        pageNumber <= pdf.document.numPages;
        pageNumber += 1
      ) {
        if (disposed) return;
        const page = await pdf.document.getPage(pageNumber);
        if (disposed) return;
        // PDF points are based on 72 DPI while CSS pixels use 96 DPI.
        // Applying the standard PDF.js conversion makes the displayed zoom
        // match regular PDF readers.
        const viewport = page.getViewport({ scale: (zoom / 100) * CSS_UNITS });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const wrapper = document.createElement('div');
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas 2D indisponible.');

        wrapper.className = 'relative mb-3 flex-shrink-0 bg-white shadow-md';
        wrapper.dataset.pageNumber = String(pageNumber);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        canvas.setAttribute('aria-label', `Page ${pageNumber}`);
        canvas.className = onSyncToSourceRef.current ? 'cursor-crosshair' : '';
        canvas.addEventListener('dblclick', (event) => {
          // Ctrl/Cmd + click is already handled below. Ignoring its dblclick
          // companion prevents one gesture from launching three searches.
          const syncToSource = onSyncToSourceRef.current;
          if (!syncToSource || event.ctrlKey || event.metaKey) return;
          const bounds = canvas.getBoundingClientRect();
          const point = toPdfCoordinates(
            { x: event.clientX, y: event.clientY },
            bounds,
            viewport.scale,
          );
          syncToSource({
            page: pageNumber,
            ...point,
          });
        });
        canvas.addEventListener('click', (event) => {
          const syncToSource = onSyncToSourceRef.current;
          if (
            !syncToSource ||
            !(event.ctrlKey || event.metaKey) ||
            event.detail > 1
          )
            return;
          const bounds = canvas.getBoundingClientRect();
          const point = toPdfCoordinates(
            { x: event.clientX, y: event.clientY },
            bounds,
            viewport.scale,
          );
          syncToSource({
            page: pageNumber,
            ...point,
          });
        });
        wrapper.appendChild(canvas);
        if (syncTarget?.page === pageNumber) {
          const highlight = document.createElement('div');
          highlight.setAttribute('aria-label', 'Position synchronisée');
          highlight.className =
            'pointer-events-none absolute z-10 rounded bg-amber-300/50 ring-2 ring-amber-500 transition-opacity';
          highlight.style.left = `${syncTarget.x * viewport.scale}px`;
          highlight.style.top = `${syncTarget.y * viewport.scale}px`;
          highlight.style.width = `${Math.max(8, (syncTarget.width ?? 12) * viewport.scale)}px`;
          highlight.style.height = `${Math.max(8, (syncTarget.height ?? 12) * viewport.scale)}px`;
          wrapper.appendChild(highlight);
          window.setTimeout(() => {
            highlight.style.opacity = '0';
          }, 1800);
        }
        target.appendChild(wrapper);

        const renderTask = page.render({
          canvasContext: context,
          viewport,
          transform:
            outputScale === 1
              ? undefined
              : [outputScale, 0, 0, outputScale, 0, 0],
        });
        renderTasks.push(renderTask);
        try {
          await renderTask.promise;
          if (syncTarget?.page === pageNumber) {
            wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        } catch (cause: unknown) {
          if (disposed) return;
          // A single problematic page must not hide the complete document.
          console.error(`PDF page ${pageNumber}:`, cause);
          wrapper.replaceChildren();
          const message = document.createElement('p');
          message.className = 'p-6 text-sm text-red-700';
          message.textContent = `Impossible d’afficher la page ${pageNumber}.`;
          wrapper.appendChild(message);
        }
      }
      if (!disposed && !syncTarget && scroller) {
        const maxScroll = Math.max(
          0,
          scroller.scrollHeight - scroller.clientHeight,
        );
        scroller.scrollTop = preservedScrollRatio.current * maxScroll;
      }
    })().catch((cause: unknown) => {
      if (!disposed) {
        console.error('PDF page rendering:', cause);
      }
    });

    return () => {
      disposed = true;
      if (scroller) {
        const maxScroll = scroller.scrollHeight - scroller.clientHeight;
        if (maxScroll > 0) {
          preservedScrollRatio.current = scroller.scrollTop / maxScroll;
        }
      }
      renderTasks.forEach((task) => task.cancel());
      target.replaceChildren();
    };
  }, [pdf, syncTarget, url, zoom]);

  return (
    <div
      ref={scrollContainer}
      className="relative h-full min-h-[300px] w-full overflow-auto bg-slate-700"
    >
      {!pdf && !error && (
        <p role="status" className="p-4 text-center text-sm text-slate-500">
          Chargement du PDF…
        </p>
      )}
      <div
        ref={pages}
        className="flex min-h-full min-w-max flex-col items-center px-3 py-3"
        aria-label="Pages du PDF"
      />
      {error && (
        <p
          role="alert"
          className="absolute inset-x-0 top-0 bg-white p-4 text-sm text-red-700"
        >
          Impossible d’afficher le PDF dans l’aperçu.
        </p>
      )}
    </div>
  );
}
