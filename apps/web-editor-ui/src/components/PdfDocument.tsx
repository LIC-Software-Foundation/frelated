import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

type LoadedPdf = { document: PDFDocumentProxy; sourceUrl: string };
const CSS_UNITS = 96 / 72;

/** Render PDF pages inside the application, without the browser PDF toolbar. */
export default function PdfDocument({
  url,
  zoom,
}: {
  url: string;
  zoom: number;
}) {
  const pages = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<LoadedPdf>();
  const [error, setError] = useState(false);

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

        wrapper.className = 'mb-3 flex-shrink-0 bg-white shadow-md';
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        canvas.setAttribute('aria-label', `Page ${pageNumber}`);
        wrapper.appendChild(canvas);
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
    })().catch((cause: unknown) => {
      if (!disposed) {
        console.error('PDF page rendering:', cause);
      }
    });

    return () => {
      disposed = true;
      renderTasks.forEach((task) => task.cancel());
      target.replaceChildren();
    };
  }, [pdf, url, zoom]);

  return (
    <div className="relative h-full min-h-[300px] w-full overflow-auto bg-slate-700">
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
