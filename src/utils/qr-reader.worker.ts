/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import jsQR from 'jsqr';

const ctx: Worker = self as any;

ctx.addEventListener('message', (e: MessageEvent) => {
  const { data, width, height } = e.data;

  try {
    // Run jsQR decoding on the transferred pixel buffer
    const code = jsQR(data, width, height, {
      inversionAttempts: 'attemptBoth',
    });

    ctx.postMessage({
      type: 'SCAN_RESULT',
      result: code ? code.data : null,
      location: code ? code.location : null,
      width,
      height,
    });
  } catch (err: any) {
    ctx.postMessage({
      type: 'SCAN_ERROR',
      error: err.message || 'Decoding failed',
    });
  }
});
