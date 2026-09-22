import { describe, expect, it } from 'vitest';
import { toPdfCoordinates } from '../src/components/pdfCoordinates';

describe('PDF SyncTeX coordinates', () => {
  it('converts CSS coordinates independently of zoom', () => {
    const normal = toPdfCoordinates(
      { x: 210, y: 320 },
      { left: 10, top: 20 },
      2,
    );
    const zoomed = toPdfCoordinates(
      { x: 310, y: 470 },
      { left: 10, top: 20 },
      3,
    );
    expect(normal).toEqual({ x: 100, y: 150 });
    expect(zoomed).toEqual({ x: 100, y: 150 });
  });
});
