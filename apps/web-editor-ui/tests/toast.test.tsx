import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast';
import { useToast } from '../src/components/ui/ToastContext';

function ToastTrigger() {
  const { toast } = useToast();
  return (
    <button
      onClick={() => toast('Aucune zone de texte synchronisable.', 'warning')}
    >
      Signaler
    </button>
  );
}

it('keeps a single visible toast when the same event is reported repeatedly', () => {
  render(
    <ToastProvider>
      <ToastTrigger />
    </ToastProvider>,
  );
  const trigger = screen.getByRole('button', { name: 'Signaler' });
  fireEvent.click(trigger);
  fireEvent.click(trigger);
  fireEvent.click(trigger);
  expect(
    screen.getAllByText('Aucune zone de texte synchronisable.'),
  ).toHaveLength(1);
});
