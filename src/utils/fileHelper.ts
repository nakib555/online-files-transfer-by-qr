/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileMetadata } from '../types';

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

/**
 * Computes the CRC32 checksum for a given string as a hex string.
 */
export function computeCrc32(str: string): string {
  if (!crcTable) {
    crcTable = makeCrcTable();
  }
  let crc = 0 ^ (-1);
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    crc = (crc >>> 8) ^ crcTable[(crc ^ code) & 0xFF];
  }
  const checksum = (crc ^ (-1)) >>> 0;
  return checksum.toString(16).toUpperCase().padStart(8, '0');
}

/**
 * Progressive CRC32 generator for stream or chunk-by-chunk calculations.
 */
export class CRC32 {
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

/**
 * Dynamically calculates optimal chunk size based on device screen resolution and data density.
 * Ensures resulting QR codes are highly scannable by low-end cameras.
 */
export function calculateOptimalChunkSize(
  fileSize: number,
  fileName: string,
  fileType: string
): { chunkSize: number; explanations: string[]; qrVersion: number } {
  // Baseline characters for general balanced operations
  let optimal = 200; 
  const explanations: string[] = [];

  // 1. Device Screen Resolution & Viewport constraints
  const width = typeof window !== 'undefined' ? (window.screen?.width || window.innerWidth) : 1024;
  const height = typeof window !== 'undefined' ? (window.screen?.height || window.innerHeight) : 768;
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 2;
  const minDim = Math.min(width, height);

  if (minDim < 480) {
    optimal = 110;
    explanations.push("Small mobile screen detected (reducing density to maximize module physical size)");
  } else if (minDim < 768) {
    optimal = 160;
    explanations.push("Medium mobile/tablet screen detected (adjusting payload for optical alignment)");
  } else {
    optimal = 260;
    explanations.push("Large high-resolution desktop screen active");
  }

  if (dpr < 2) {
    optimal = Math.round(optimal * 0.8);
    explanations.push("Low-density display detected (reducing grid density to prevent blur scanner failures)");
  }

  // 2. Data Density / Entropy analysis
  const isBinary = 
    /(\.zip|\.tar|\.gz|\.pdf|\.png|\.jpg|\.jpeg|\.mp3|\.mp4|\.gif|\.bin|\.exe|\.dmg|\.iso|\.tar\.gz)$/i.test(fileName) ||
    (fileType && !/^(text\/|application\/json|application\/javascript|application\/xml)/.test(fileType));

  if (isBinary) {
    optimal = Math.round(optimal * 0.85);
    explanations.push("High-entropy binary stream detected (minimized to prevent overly dense QR matrix grid)");
  } else {
    optimal = Math.round(optimal * 1.15);
    explanations.push("Low-entropy plain text stream detected (optimized with higher packing density)");
  }

  // Ensure reasonable scannable bounds (80 characters to 600 characters)
  // Low-end cameras struggle immensely above 400 chars. Let's keep optimal highly scannable.
  optimal = Math.max(80, Math.min(600, Math.round(optimal / 10) * 10));

  // Determine estimated QR version for the optimal character count
  let estVersion = 10;
  if (optimal <= 100) estVersion = 7;
  else if (optimal <= 160) estVersion = 11;
  else if (optimal <= 240) estVersion = 15;
  else if (optimal <= 340) estVersion = 20;
  else estVersion = 27;

  return {
    chunkSize: optimal,
    explanations,
    qrVersion: estVersion
  };
}

/**
 * Reassembles raw base64 data from a record of chunk index and chunk payload.
 */
export function reassembleBase64(base64Chunks: Record<number, string>): string {
  return Object.keys(base64Chunks)
    .map(Number)
    .filter(idx => idx > 0) // Skip chunk 0 (metadata)
    .sort((a, b) => a - b)
    .map(idx => base64Chunks[idx])
    .join('');
}

/**
 * Converts a browser File object to a raw base64-encoded string (no data URL prefix).
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Extract the raw base64 part
      const commaIndex = result.indexOf(',');
      if (commaIndex !== -1) {
        resolve(result.substring(commaIndex + 1));
      } else {
        resolve(result);
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

/**
 * Splits a base64 string into sequential chunks of a specified size.
 */
export function chunkBase64(base64: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  let offset = 0;
  while (offset < base64.length) {
    chunks.push(base64.substring(offset, offset + chunkSize));
    offset += chunkSize;
  }
  return chunks;
}

/**
 * Formats a chunk with the standard header: index/total|payload
 */
export function formatChunk(index: number, total: number, payload: string): string {
  return `${index}/${total}|${payload}`;
}

/**
 * Parses a string to extract chunk index, total, and payload.
 * Returns null if the format is invalid.
 */
export interface ParsedChunk {
  index: number;
  total: number;
  payload: string;
}

export function parseChunk(raw: string): ParsedChunk | null {
  try {
    const dividerIndex = raw.indexOf('|');
    if (dividerIndex === -1) return null;

    const header = raw.substring(0, dividerIndex);
    const payload = raw.substring(dividerIndex + 1);

    const parts = header.split('/');
    if (parts.length !== 2) return null;

    const index = parseInt(parts[0], 10);
    const total = parseInt(parts[1], 10);

    if (isNaN(index) || isNaN(total)) return null;

    return { index, total, payload };
  } catch (e) {
    return null;
  }
}

/**
 * Decodes metadata JSON payload from chunk 0.
 */
export function parseMetadata(payload: string): FileMetadata | null {
  try {
    return JSON.parse(payload) as FileMetadata;
  } catch (e) {
    return null;
  }
}

/**
 * Formats file size in readable format (KB, MB).
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Converts a small Blob/File slice to a raw base64-encoded string.
 */
export function blobToBase64(blob: Blob): Promise<string> {
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
}

/**
 * Converts a base64 string to a Uint8Array.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const byteCharacters = atob(base64);
  const byteNumbers = new Uint8Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  return byteNumbers;
}

/**
 * Reconstructs a Base64 string back into a File Blob and triggers an automatic browser download.
 * Designed to prevent RangeError/out-of-memory when working with 1GB+ files.
 */
export function downloadFile(base64Chunks: Record<number, string>, metadata: FileMetadata) {
  const sortedIndices = Object.keys(base64Chunks)
    .map(Number)
    .filter(idx => idx > 0) // Skip chunk 0 (metadata)
    .sort((a, b) => a - b);

  const byteArrays: Uint8Array[] = [];
  for (const idx of sortedIndices) {
    byteArrays.push(base64ToUint8Array(base64Chunks[idx]));
  }

  const blob = new Blob(byteArrays, { type: metadata.type });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = metadata.name;
  document.body.appendChild(link);
  link.click();
  
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Converts a base64 string to a Blob object.
 */
export function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteArray = base64ToUint8Array(base64);
  return new Blob([byteArray], { type: mimeType });
}

const DB_NAME = 'OpticalAirgapDB';
const STORE_NAME = 'chunks';
const DB_VERSION = 1;

export function initIndexedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('IndexedDB open error:', event);
      reject(new Error('Failed to open IndexedDB'));
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

export async function saveChunkToDB(sessionId: string, index: number, payload: string): Promise<void> {
  const db = await initIndexedDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const id = `${sessionId}:${index}`;
    
    const request = store.put({
      id,
      sessionId,
      index,
      payload
    });

    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e);
  });
}

export async function getChunkFromDB(sessionId: string, index: number): Promise<string | null> {
  const db = await initIndexedDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const id = `${sessionId}:${index}`;
    
    const request = store.get(id);

    request.onsuccess = () => {
      const result = request.result;
      resolve(result ? result.payload : null);
    };
    request.onerror = (e) => reject(e);
  });
}

export async function deleteSessionFromDB(sessionId: string): Promise<void> {
  const db = await initIndexedDB();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    const request = store.openCursor();
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) {
        if (cursor.value.sessionId === sessionId) {
          cursor.delete();
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = (e) => reject(e);
  });
}

export function clearSession(sessionId: string) {
  // 1. Remove from localStorage active sessions
  const savedSessionsStr = localStorage.getItem('optgap:active-sessions');
  if (savedSessionsStr) {
    try {
      let sessions: any[] = JSON.parse(savedSessionsStr);
      sessions = sessions.filter(s => s.sessionId !== sessionId);
      localStorage.setItem('optgap:active-sessions', JSON.stringify(sessions));
    } catch (e) {
      console.error(e);
    }
  }
  // 2. Remove from IndexedDB
  deleteSessionFromDB(sessionId).catch(err => console.error("Failed to delete DB chunks:", err));
}

export async function downloadFileFromDB(sessionId: string, metadata: FileMetadata): Promise<void> {
  const totalChunksExpected = metadata.chunkCount;
  const byteArrays: Uint8Array[] = [];
  
  for (let i = 1; i <= totalChunksExpected; i++) {
    const payload = await getChunkFromDB(sessionId, i);
    if (!payload) {
      throw new Error(`Chunk ${i} is missing from storage`);
    }
    byteArrays.push(base64ToUint8Array(payload));
  }

  const blob = new Blob(byteArrays, { type: metadata.type });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = metadata.name;
  document.body.appendChild(link);
  link.click();
  
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
