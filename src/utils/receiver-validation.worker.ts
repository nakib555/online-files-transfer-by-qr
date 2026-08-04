/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

let crcTable: Int32Array | null = null;

function makeCrcTable(): Int32Array {
  const cTable = new Int32Array(256);
  let c: number;
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    cTable[n] = c;
  }
  return cTable;
}

class CRC32WorkerHelper {
  private crc = 0 ^ (-1);

  constructor() {
    if (!crcTable) {
      crcTable = makeCrcTable();
    }
  }

  update(str: string) {
    const table = crcTable!;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      this.crc = (this.crc >>> 8) ^ table[(this.crc ^ code) & 0xFF];
    }
  }

  getValue(): string {
    const checksum = (this.crc ^ (-1)) >>> 0;
    return checksum.toString(16).toUpperCase().padStart(8, '0');
  }
}

const DB_NAME = 'OpticalAirgapDB';
const STORE_NAME = 'chunks';

function initIndexedDBInWorker(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onerror = () => {
      reject(new Error('Failed to open IndexedDB in worker'));
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };
  });
}

function getChunkFromDBInWorker(db: IDBDatabase, sessionId: string, index: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const id = `${sessionId}:${index}`;
      const request = store.get(id);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.payload : null);
      };

      request.onerror = (e) => reject(e);
    } catch (e) {
      reject(e);
    }
  });
}

const ctx: Worker = self as any;

ctx.addEventListener('message', async (e: MessageEvent) => {
  const { type, data } = e.data;

  if (type === 'VALIDATE_CRC') {
    const { sessionId, totalChunksExpected, expectedCrc } = data;

    try {
      const db = await initIndexedDBInWorker();
      const crcCalc = new CRC32WorkerHelper();

      for (let i = 1; i <= totalChunksExpected; i++) {
        const payload = await getChunkFromDBInWorker(db, sessionId, i);
        if (payload === null) {
          throw new Error(`Chunk segment ${i} is missing from cache database`);
        }
        crcCalc.update(payload);

        // Periodically report validation progress (every 5 chunks or at the end)
        if (i % 5 === 0 || i === totalChunksExpected) {
          ctx.postMessage({
            type: 'VALIDATE_PROGRESS',
            progress: Math.round((i / totalChunksExpected) * 100),
            currentChunk: i,
            totalChunks: totalChunksExpected
          });
        }
      }

      const computedCrc = crcCalc.getValue();
      ctx.postMessage({
        type: 'VALIDATE_COMPLETE',
        computedCrc,
        expectedCrc,
        isMatched: computedCrc === expectedCrc
      });

    } catch (err: any) {
      ctx.postMessage({
        type: 'VALIDATE_ERROR',
        error: err.message || 'Validation failed during CRC check'
      });
    }
  }
});
