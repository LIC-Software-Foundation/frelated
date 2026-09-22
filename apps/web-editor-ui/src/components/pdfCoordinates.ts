export const toPdfCoordinates = (
  client: { x: number; y: number },
  bounds: Pick<DOMRect, 'left' | 'top'>,
  viewportScale: number,
) => ({
  x: (client.x - bounds.left) / viewportScale,
  y: (client.y - bounds.top) / viewportScale,
});
