/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import QRCode from 'qrcode';
import { CRC32 } from './fileHelper';

// Define the worker's scope
const ctx: Worker = self as any;

let fileRef: File | null = null;
let cachedFrames: Record<number, { size: number; data: Uint8Array }> = {};

// Convert character payload size to byte chunk size as a multiple of 3
const getByteChunkSize = (charsSize: number) => {
  const bytes = Math.floor((charsSize * 3) / 4);
  return Math.max(3, Math.floor(bytes / 3) * 3);
};

// Convert Blob/File slice to a raw base64-encoded string using FileReader
const blobToBase64InWorker = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIndex = result.indexOf(',');
      if (commaIndex !== -1) {
        resolve(result.substring(commaIndex + 1));
      } else {
        resolve(result);
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

ctx.addEventListener('message', async (e: MessageEvent) => {
  const { type, data } = e.data;

  if (type === 'LOAD_FILE') {
    const { file, chunkSize } = data;
    fileRef = file;
    cachedFrames = {}; // Clear cache on new file load

    try {
      const byteChunkSize = getByteChunkSize(chunkSize);
      const totalDataChunks = Math.ceil(file.size / byteChunkSize);

      // Compute CRC32 progressively in blocks to update progress without freezing
      const calcChunkSize = 1.5 * 1024 * 1024; // 1.5MB blocks
      const crcCalculator = new CRC32();
      let offset = 0;
      let blockIndex = 0;
      const totalBlocks = Math.ceil(file.size / calcChunkSize);

      while (offset < file.size) {
        const sliceEnd = Math.min(file.size, offset + calcChunkSize);
        const slice = file.slice(offset, sliceEnd);
        const b64Part = await blobToBase64InWorker(slice);
        crcCalculator.update(b64Part);

        offset = sliceEnd;
        blockIndex++;

        // Send progressive hashing update
        ctx.postMessage({
          type: 'LOAD_PROGRESS',
          progress: Math.round((blockIndex / totalBlocks) * 100),
          status: `Hashing file payload integrity: ${(offset / 1024 / 1024).toFixed(2)}MB / ${(file.size / 1024 / 1024).toFixed(2)}MB`,
        });
      }

      const crc32 = crcCalculator.getValue();
      ctx.postMessage({
        type: 'LOAD_COMPLETE',
        totalChunksCount: totalDataChunks,
        crc32,
      });
    } catch (err: any) {
      ctx.postMessage({
        type: 'LOAD_ERROR',
        error: err.message || 'Failed to process file',
      });
    }
  }

  else if (type === 'GENERATE_FRAME') {
    const { index, chunkSize, totalChunksCount, computedCrc32 } = data;

    if (!fileRef) {
      ctx.postMessage({ type: 'FRAME_ERROR', index, error: 'No file active' });
      return;
    }

    // Check memory cache
    if (cachedFrames[index]) {
      const cached = cachedFrames[index];
      ctx.postMessage({
        type: 'FRAME_READY',
        index,
        size: cached.size,
        data: cached.data,
      });
      return;
    }

    try {
      let rawChunk = '';
      if (index === 0) {
        // Metadata chunk
        const meta = {
          name: fileRef.name,
          size: fileRef.size,
          type: fileRef.type || 'application/octet-stream',
          chunkCount: totalChunksCount,
          crc32: computedCrc32,
        };
        rawChunk = JSON.stringify(meta);
      } else {
        // Data chunk
        const byteChunkSize = getByteChunkSize(chunkSize);
        const start = (index - 1) * byteChunkSize;
        const end = Math.min(fileRef.size, start + byteChunkSize);
        const blobSlice = fileRef.slice(start, end);
        rawChunk = await blobToBase64InWorker(blobSlice);
      }

      // Format: index/total|payload
      const textToEncode = `${index}/${totalChunksCount}|${rawChunk}`;

      // Dynamically select the highest possible error correction level
      const len = textToEncode.length;
      let ecLevel: 'L' | 'M' | 'Q' | 'H' = 'H';
      if (len > 1250) {
        if (len <= 1630) ecLevel = 'Q';
        else if (len <= 2290) ecLevel = 'M';
        else ecLevel = 'L';
      }

      // Generate the raw QR code matrix
      const qr = QRCode.create(textToEncode, {
        errorCorrectionLevel: ecLevel,
      });

      const size = qr.modules.size;
      const matrixData = new Uint8Array(qr.modules.data);

      // Cache the frame
      cachedFrames[index] = { size, data: matrixData };

      ctx.postMessage({
        type: 'FRAME_READY',
        index,
        size,
        data: matrixData,
      });
    } catch (err: any) {
      ctx.postMessage({
        type: 'FRAME_ERROR',
        index,
        error: err.message || 'QR Code generation failed',
      });
    }
  }
});
