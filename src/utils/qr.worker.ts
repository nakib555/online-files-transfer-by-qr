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
let targetVersion: number | undefined = undefined;
let targetEcLevel: 'L' | 'M' | 'Q' | 'H' = 'H';

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
    targetVersion = undefined;
    targetEcLevel = 'H';

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

      // Estimate the worst-case text length to lock a single consistent QR version
      if (totalDataChunks > 0) {
        try {
          const sampleStart = 0;
          const sampleEnd = Math.min(file.size, byteChunkSize);
          const sampleSlice = file.slice(sampleStart, sampleEnd);
          const sampleRaw = await blobToBase64InWorker(sampleSlice);
          const worstHeader = `${totalDataChunks}/${totalDataChunks}|`;
          const textToEncode = worstHeader + sampleRaw;
          const len = textToEncode.length;
          
          if (len > 1250) {
            if (len <= 1630) targetEcLevel = 'Q';
            else if (len <= 2290) targetEcLevel = 'M';
            else targetEcLevel = 'L';
          } else {
            targetEcLevel = 'H';
          }

          const sampleQr = QRCode.create(textToEncode, { errorCorrectionLevel: targetEcLevel });
          targetVersion = sampleQr.version;
        } catch (err) {
          console.error('Failed to pre-estimate target QR version, will fallback to dynamic sizes:', err);
        }
      }

      ctx.postMessage({
        type: 'LOAD_COMPLETE',
        totalChunksCount: totalDataChunks,
        crc32,
      });

      // Spawn background progressive pre-generation of all QR frames
      // This caches frame matrices on the worker thread to guarantee 100% fluent lag-free playback.
      (async () => {
        try {
          for (let index = 0; index <= totalDataChunks; index++) {
            // Guard against subsequent file loads clearing cachedFrames or fileRef
            if (!fileRef || cachedFrames === null) break;
            if (cachedFrames[index]) continue;

            let rawChunk = '';
            if (index === 0) {
              const meta = {
                name: fileRef.name,
                size: fileRef.size,
                type: fileRef.type || 'application/octet-stream',
                chunkCount: totalDataChunks,
                crc32,
              };
              rawChunk = JSON.stringify(meta);
            } else {
              const byteChunkSize = getByteChunkSize(chunkSize);
              const start = (index - 1) * byteChunkSize;
              const end = Math.min(fileRef.size, start + byteChunkSize);
              const blobSlice = fileRef.slice(start, end);
              rawChunk = await blobToBase64InWorker(blobSlice);
            }

            const textToEncode = `${index}/${totalDataChunks}|${rawChunk}`;
            const len = textToEncode.length;
            let ecLevel: 'L' | 'M' | 'Q' | 'H' = 'H';
            if (len > 1250) {
              if (len <= 1630) ecLevel = 'Q';
              else if (len <= 2290) ecLevel = 'M';
              else ecLevel = 'L';
            }

            let qr;
            try {
              qr = QRCode.create(textToEncode, {
                version: targetVersion,
                errorCorrectionLevel: targetVersion ? targetEcLevel : ecLevel,
              });
            } catch (qrErr) {
              qr = QRCode.create(textToEncode, {
                errorCorrectionLevel: ecLevel,
              });
            }

            const size = qr.modules.size;
            const matrixData = new Uint8Array(qr.modules.data);

            // Double check to avoid race conditions if settings changed mid-generation
            if (fileRef) {
              cachedFrames[index] = { size, data: matrixData };

              ctx.postMessage({
                type: 'PREGEN_PROGRESS',
                index,
                total: totalDataChunks,
                progress: Math.round((index / totalDataChunks) * 100)
              });
            }
          }
        } catch (err: any) {
          console.error('Background pre-rendering failed:', err);
        }
      })();

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
      let qr;
      try {
        qr = QRCode.create(textToEncode, {
          version: targetVersion,
          errorCorrectionLevel: targetVersion ? targetEcLevel : ecLevel,
        });
      } catch (qrErr) {
        qr = QRCode.create(textToEncode, {
          errorCorrectionLevel: ecLevel,
        });
      }

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
