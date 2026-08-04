/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface FileMetadata {
  name: string;
  size: number;
  type: string;
  chunkCount: number;
  crc32: string;
}

export interface Chunk {
  index: number;
  total: number;
  payload: string;
}

export type AppMode = 'home' | 'send' | 'receive';

export interface TransferStats {
  elapsedTime: number; // in ms
  currentFps: number;
  speedBps: number; // Bytes per second
  chunksSent: number;
}

export interface ReceiverLog {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

export interface SavedSession {
  sessionId: string;
  metadata: FileMetadata;
  completedIndices: number[];
  lastUpdated: number;
}
