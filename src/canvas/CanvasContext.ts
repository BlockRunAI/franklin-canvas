// Shared context so individual nodes can open the "what node next?" menu and
// run image-edit ops without each one being plumbed through CanvasView.

import { createContext, useContext } from 'react';

export type ImageEditOp = 'outpaint' | 'enhance' | 'cutout' | 'pixels';

export interface CanvasCtx {
  /**
   * Open the connect-menu anchored near a screen-space point, with the given
   * source node id pre-filled. Called by per-node "+" buttons on the edge of
   * generation cards.
   */
  openConnectMenu: (
    fromNodeId: string,
    screenX: number,
    screenY: number,
    side?: 'left' | 'right',
  ) => void;
  /**
   * Run an image-edit operation (outpaint / enhance / cutout / upscale) on a
   * source node's current result. Spawns a new imagegen node to the right,
   * wired from the source, pre-filled with the op's prompt + the source image
   * as reference, then runs it as image-to-image.
   */
  runImageEdit: (fromNodeId: string, op: ImageEditOp) => void;
  /**
   * Split a node's result image into an N×N grid of separate image nodes —
   * pure client-side cropping (no model call, no spend).
   */
  runImageSplit: (fromNodeId: string, grid: number) => void;
}

export const CanvasContext = createContext<CanvasCtx>({
  openConnectMenu: () => {},
  runImageEdit: () => {},
  runImageSplit: () => {},
});

export const useCanvasCtx = () => useContext(CanvasContext);
