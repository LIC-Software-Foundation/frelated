import { EditorView } from '@codemirror/view';

// Preserve the visible editor during a hot reload or an explicit save. This
// tab-local recovery copy is never used to silently overwrite a server file.
export function captureVisibleDraft(): string | undefined {
  const element = document.querySelector<HTMLElement>('.cm-editor');
  const view = element && EditorView.findFromDOM(element);
  if (!view) return undefined;
  const content = view.state.doc.toString();
  if (content.length) {
    try {
      sessionStorage.setItem(
        `frelated-recovery:${window.location.pathname}`,
        content,
      );
    } catch {
      /* Storage may be unavailable. */
    }
  }
  return content;
}
// Capture before React refresh can dispose the existing CodeMirror instance.
if (typeof document !== 'undefined') captureVisibleDraft();

export function readRecoveryDraft(): string | null {
  try {
    return sessionStorage.getItem(
      `frelated-recovery:${window.location.pathname}`,
    );
  } catch {
    return null;
  }
}

export function restoreRecoveryDraft(): boolean {
  const content = readRecoveryDraft();
  const element = document.querySelector<HTMLElement>('.cm-editor');
  const view = element && EditorView.findFromDOM(element);
  if (!view || !content) return false;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
  });
  return true;
}
