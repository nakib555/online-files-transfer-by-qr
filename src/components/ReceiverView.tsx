/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Camera, CheckCircle2, AlertTriangle, RefreshCw, 
  Activity, Video, Download, Play, Pause, ListFilter, Sliders
} from 'lucide-react';
import { FileMetadata, ReceiverLog, SavedSession } from '../types';
import { 
  parseChunk, parseMetadata, formatBytes, CRC32,
  saveChunkToDB, getChunkFromDB, clearSession, downloadFileFromDB 
} from '../utils/fileHelper';
import QrScanner from 'qr-scanner';

export default function ReceiverView() {
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [isScanning, setIsScanning] = useState<boolean>(true);
  const [metadata, setMetadata] = useState<FileMetadata | null>(null);
  const [qrLocation, setQrLocation] = useState<{
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
    opacity: number;
  } | null>(null);
  const [scanResolutionMode, setScanResolutionMode] = useState<'auto' | 'high-res' | 'high-speed'>('auto');
  const [isLaserLockReceiverActive, setIsLaserLockReceiverActive] = useState<boolean>(true);
  
  const smoothedLocationRef = useRef<{
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
  } | null>(null);
  const lastDetectedTimeRef = useRef<number>(0);
  const scanResolutionModeRef = useRef<'auto' | 'high-res' | 'high-speed'>('auto');
  
  // Storage for chunks: key is chunk index, value is the base64 payload
  const [capturedChunks, setCapturedChunks] = useState<Record<number, string>>({});
  const [logs, setLogs] = useState<ReceiverLog[]>([]);
  const [cameraError, setCameraError] = useState<string>('');
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [verificationProgress, setVerificationProgress] = useState<number>(0);
  const [verificationStatus, setVerificationStatus] = useState<string>('');
  const [transferSpeed, setTransferSpeed] = useState<number>(0);
  const [isHapticEnabled, setIsHapticEnabled] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('optgap:haptic-enabled');
      return stored !== 'false';
    } catch {
      return true;
    }
  });
  const bytesReceivedRef = useRef<{time: number, bytes: number}[]>([]);

  // Load saved sessions from localStorage on mount
  useEffect(() => {
    loadSavedSessions();
  }, []);

  const loadSavedSessions = () => {
    try {
      const savedStr = localStorage.getItem('optgap:active-sessions');
      if (savedStr) {
        setSavedSessions(JSON.parse(savedStr));
      } else {
        setSavedSessions([]);
      }
    } catch (err) {
      console.error('Failed to load saved sessions:', err);
    }
  };

  const handleDeleteSession = (sessId: string, name: string) => {
    if (confirm(`Are you sure you want to delete the saved progress for "${name}"?`)) {
      clearSession(sessId);
      loadSavedSessions();
      addLog('info', `Deleted saved progress for "${name}".`);
    }
  };

  const handleResumeSession = (session: SavedSession) => {
    setMetadata(session.metadata);
    
    const chunksMap: Record<number, string> = {};
    chunksMap[0] = JSON.stringify(session.metadata);
    session.completedIndices.forEach(idx => {
      if (idx > 0) chunksMap[idx] = '';
    });
    
    setCapturedChunks(chunksMap);
    setIsScanning(true);
    addLog('success', `Resumed "${session.metadata.name}": ${session.completedIndices.length}/${session.metadata.chunkCount} sectors loaded.`);
  };

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const requestRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastScanTimeRef = useRef<number>(0);
  const metadataRef = useRef<FileMetadata | null>(null);
  const isHapticEnabledRef = useRef<boolean>(true);

  // High-performance Web Worker pool and location smoothing references
  const scanWorkersRef = useRef<Worker[]>([]);
  const nextWorkerIdxRef = useRef<number>(0);
  const workerActiveRef = useRef<boolean[]>([]);
  const targetLocationRef = useRef<{
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
  } | null>(null);
  const renderedLocationRef = useRef<{
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
    opacity: number;
  } | null>(null);

  // Synchronize state values to refs to avoid event listener closures issues
  useEffect(() => {
    metadataRef.current = metadata;
  }, [metadata]);

  useEffect(() => {
    isHapticEnabledRef.current = isHapticEnabled;
  }, [isHapticEnabled]);

  useEffect(() => {
    scanResolutionModeRef.current = scanResolutionMode;
  }, [scanResolutionMode]);

  const forceRequestPermission = async () => {
    setCameraError('');
    addLog('info', 'Querying video devices. Explicit camera access requested...');
    try {
      // Force prompt browser for camera permission
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      // Clean up the stream immediately since we just wanted the hardware access consent
      stream.getTracks().forEach(track => track.stop());
      
      // Enumerate devices now that permission is granted
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      setCameras(videoDevices);
      
      if (videoDevices.length > 0) {
        // Prefer environment/back camera if available
        const backCamera = videoDevices.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('environment'));
        setSelectedCameraId(backCamera ? backCamera.deviceId : videoDevices[0].deviceId);
        addLog('success', `Permission granted! Found ${videoDevices.length} camera(s).`);
      } else {
        setCameraError('No video input hardware detected on your device.');
        addLog('error', 'Camera hardware list returned empty.');
      }
    } catch (err: any) {
      console.error('Camera permission request failed:', err);
      let errMsg = 'Camera access denied or unavailable. Please enable permissions.';
      if (err.name === 'NotAllowedError') {
        errMsg = 'Camera permission was explicitly denied. Please reset permissions in your browser address bar.';
      } else if (err.name === 'NotFoundError') {
        errMsg = 'No camera hardware found on this system.';
      }
      setCameraError(errMsg);
      addLog('error', `Permission request failed: ${err.message || err.name}`);
    }
  };

  const handleToggleScanning = async () => {
    if (!isScanning && cameras.length === 0) {
      await forceRequestPermission();
    }
    setIsScanning(!isScanning);
  };

  // Initialize and enumerate available camera hardware
  useEffect(() => {
    forceRequestPermission();
    return () => {
      stopCamera();
    };
  }, []);

  const qrEngineRef = useRef<any>(null);
  const isDecodingRef = useRef<boolean>(false);

  // Initialize QrScanner Engine
  useEffect(() => {
    let engine: any = null;
    QrScanner.createQrEngine().then(e => {
      engine = e;
      qrEngineRef.current = engine;
    }).catch(err => {
      console.error('Failed to initialize QrScanner engine:', err);
    });

    return () => {
      if (engine && typeof engine.terminate === 'function') {
        engine.terminate();
      } else if (engine && typeof engine.postMessage === 'function') {
        engine.postMessage({ type: 'close' });
      }
    };
  }, []);

  // Control camera stream based on selectedCameraId and isScanning
  useEffect(() => {
    if (isScanning) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isScanning, selectedCameraId]);

  // Periodically compute RX transfer speed
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isScanning) {
        setTransferSpeed(0);
        return;
      }
      const now = Date.now();
      // Keep only chunks from the last 1000ms
      bytesReceivedRef.current = bytesReceivedRef.current.filter(entry => now - entry.time <= 1000);
      const totalBytes = bytesReceivedRef.current.reduce((acc, entry) => acc + entry.bytes, 0);
      setTransferSpeed(totalBytes / (1024 * 1024)); // in MB/s
    }, 500);
    return () => clearInterval(interval);
  }, [isScanning]);

  const addLog = (type: ReceiverLog['type'], message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const id = Math.random().toString(36).substring(2, 9);
    setLogs((prev) => [{ id, timestamp, type, message }, ...prev].slice(0, 50));
  };

  const startCamera = async () => {
    stopCamera();
    setCameraError('');
    
    // Define a helper to attempt to obtain a stream with specific video constraints
    const attemptStream = async (videoConstraints: MediaTrackConstraints): Promise<MediaStream> => {
      // First try with advanced focusMode constraint
      try {
        const withAdvanced = {
          ...videoConstraints,
          advanced: [{ focusMode: 'continuous' } as any]
        };
        return await navigator.mediaDevices.getUserMedia({ video: withAdvanced });
      } catch (e) {
        // If advanced constraints fail, try without them
        return await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
      }
    };

    try {
      let stream: MediaStream;

      // Use safe, highly compatible constraints without max to avoid OverconstrainedError
      const standardResolution = {
        width: { ideal: 1280 },
        height: { ideal: 720 }
      };

      if (selectedCameraId) {
        try {
          addLog('info', 'Attempting connection to selected camera ID.');
          stream = await attemptStream({
            deviceId: { exact: selectedCameraId },
            ...standardResolution
          });
        } catch (err) {
          addLog('warning', 'Selected camera unavailable. Falling back to default rear camera.');
          // Fallback to environment
          try {
            stream = await attemptStream({
              facingMode: 'environment',
              ...standardResolution
            });
          } catch (err2) {
            addLog('warning', 'Rear camera unavailable. Falling back to front-facing camera.');
            try {
              stream = await attemptStream({
                facingMode: 'user',
                ...standardResolution
              });
            } catch (err3) {
              addLog('warning', 'Specific camera modes failed. Requesting any available video source.');
              stream = await navigator.mediaDevices.getUserMedia({ video: true });
            }
          }
        }
      } else {
        // No pre-selected camera ID: attempt environment camera first
        try {
          addLog('info', 'Requesting rear-facing camera (environment)...');
          stream = await attemptStream({
            facingMode: 'environment',
            ...standardResolution
          });
        } catch (err) {
          addLog('warning', 'Rear camera unavailable or failed. Trying front-facing camera (user)...');
          try {
            stream = await attemptStream({
              facingMode: 'user',
              ...standardResolution
            });
          } catch (err2) {
            addLog('warning', 'Specific camera modes failed. Requesting any available video source.');
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
          }
        }
      }

      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true'); // Required for iOS
        videoRef.current.play().catch(playErr => {
          console.warn('Autoplay blocked or play failed:', playErr);
        });
        addLog('info', `Camera link established. Scan loop starting.`);
      }

      // Start processing frames
      requestRef.current = requestAnimationFrame(scanFrame);
    } catch (err: any) {
      console.error('Camera initialization error:', err);
      setIsScanning(false);
      setCameraError('Failed to capture stream. Camera might be in use or blocked.');
      addLog('error', `Failed to open camera: ${err.message || 'unknown'}`);
    }
  };

  const stopCamera = () => {
    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
      requestRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const scanFrame = () => {
    if (!videoRef.current || !canvasRef.current || !isScanning) {
      requestRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    const now = Date.now();
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
      let targetWidth = video.videoWidth;
      let targetHeight = video.videoHeight;

      // Determine the maximum dimension dynamically for standard speed vs ultra-density vs high-speed
      let maxDimension = 720;
      const currentMode = scanResolutionModeRef.current;
      if (currentMode === 'high-res') {
        maxDimension = 1920; // Allow 1080p full resolution
      } else if (currentMode === 'high-speed') {
        maxDimension = 600; // Faster processing
      } else if (currentMode === 'auto') {
        const timeSinceLastDecode = now - lastDetectedTimeRef.current;
        if (timeSinceLastDecode > 1500) {
          // If we haven't seen a QR frame in over 1.5 seconds, start checking full resolution
          // on alternating frames to capture any ultra-dense QR codes without missing a beat!
          maxDimension = (now % 2 === 0) ? 1280 : 720;
        } else {
          maxDimension = 720;
        }
      }

      if (targetWidth > maxDimension || targetHeight > maxDimension) {
        if (targetWidth > targetHeight) {
          targetHeight = Math.round((targetHeight * maxDimension) / targetWidth);
          targetWidth = maxDimension;
        } else {
          targetWidth = Math.round((targetWidth * maxDimension) / targetHeight);
          targetHeight = maxDimension;
        }
      }

      // Avoid redundant canvas reallocation/resizing which triggers garbage collection and pipeline flushes
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      // Draw the video frame downscaled
      ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

      // Run QrScanner decoding if not already decoding
      if (qrEngineRef.current && !isDecodingRef.current) {
        isDecodingRef.current = true;
        
        // --- Faint Scan Health Heatmap Overlay ---
        const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
        const gridCols = 20;
        const gridRows = 20;
        const cellW = targetWidth / gridCols;
        const cellH = targetHeight / gridRows;
        const data = imageData.data;
        
        ctx.save();
        for (let y = 0; y < gridRows; y++) {
          for (let x = 0; x < gridCols; x++) {
            let minLum = 255;
            let maxLum = 0;
            
            const sampleStepX = Math.max(1, Math.floor(cellW / 4));
            const sampleStepY = Math.max(1, Math.floor(cellH / 4));

            for (let sy = 0; sy < cellH; sy += sampleStepY) {
              for (let sx = 0; sx < cellW; sx += sampleStepX) {
                const px = Math.floor(x * cellW + sx);
                const py = Math.floor(y * cellH + sy);
                if (px < targetWidth && py < targetHeight) {
                  const i = (py * targetWidth + px) * 4;
                  const lum = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
                  if (lum < minLum) minLum = lum;
                  if (lum > maxLum) maxLum = lum;
                }
              }
            }
            
            const contrast = maxLum - minLum;
            if (contrast > 80) {
              const healthScore = Math.min(1, contrast / 200);
              ctx.fillStyle = `rgba(16, 185, 129, ${healthScore * 0.15})`;
              ctx.fillRect(Math.floor(x * cellW), Math.floor(y * cellH), Math.ceil(cellW), Math.ceil(cellH));
            } else if (contrast < 30) {
              ctx.fillStyle = `rgba(239, 68, 68, 0.05)`;
              ctx.fillRect(Math.floor(x * cellW), Math.floor(y * cellH), Math.ceil(cellW), Math.ceil(cellH));
            }
          }
        }
        ctx.restore();

        // Scan the canvas directly
        QrScanner.scanImage(canvas, { qrEngine: qrEngineRef.current, returnDetailedScanResult: true })
          .then((result: any) => {
            isDecodingRef.current = false;
            if (result && result.data) {
              handleScannedCode(result.data);
              
              const containerWidth = video.clientWidth;
              const containerHeight = video.clientHeight;
              const videoRatio = video.videoWidth / video.videoHeight;
              const containerRatio = containerWidth / containerHeight;

              let renderedWidth = containerWidth;
              let renderedHeight = containerHeight;
              let xOffset = 0;
              let yOffset = 0;

              if (containerRatio > videoRatio) {
                renderedWidth = containerWidth;
                renderedHeight = containerWidth / videoRatio;
                yOffset = (containerHeight - renderedHeight) / 2;
              } else {
                renderedHeight = containerHeight;
                renderedWidth = containerHeight * videoRatio;
                xOffset = (containerWidth - renderedWidth) / 2;
              }

              const transformPoint = (p: { x: number; y: number }) => {
                const normX = p.x / targetWidth;
                const normY = p.y / targetHeight;
                return {
                  x: xOffset + normX * renderedWidth,
                  y: yOffset + normY * renderedHeight,
                };
              };

              if (result.cornerPoints && result.cornerPoints.length >= 3) {
                const targetLocation = {
                  topLeft: transformPoint(result.cornerPoints[0]),
                  topRight: transformPoint(result.cornerPoints[1]),
                  bottomRight: transformPoint(result.cornerPoints[2]),
                  bottomLeft: transformPoint(result.cornerPoints[3] || result.cornerPoints[0]),
                };
                targetLocationRef.current = targetLocation;
                lastDetectedTimeRef.current = Date.now();
              }
            }
          })
          .catch(() => {
             // QrScanner returns an error when no QR is found, just ignore and reset flag
             isDecodingRef.current = false;
          });
      }
    }

    // Smooth the target overlay location at the full screen refresh rate
    if (targetLocationRef.current) {
      const msSinceDetect = now - lastDetectedTimeRef.current;
      if (msSinceDetect < 550) {
        const targetOpacity = msSinceDetect > 150
          ? Math.max(0.01, 1 - (msSinceDetect - 150) / 400)
          : 1;

        if (!renderedLocationRef.current) {
          renderedLocationRef.current = {
            ...targetLocationRef.current,
            opacity: targetOpacity
          };
        } else {
          const k = 0.22; // Smoothing coefficient per frame
          renderedLocationRef.current = {
            topLeft: {
              x: renderedLocationRef.current.topLeft.x * (1 - k) + targetLocationRef.current.topLeft.x * k,
              y: renderedLocationRef.current.topLeft.y * (1 - k) + targetLocationRef.current.topLeft.y * k,
            },
            topRight: {
              x: renderedLocationRef.current.topRight.x * (1 - k) + targetLocationRef.current.topRight.x * k,
              y: renderedLocationRef.current.topRight.y * (1 - k) + targetLocationRef.current.topRight.y * k,
            },
            bottomRight: {
              x: renderedLocationRef.current.bottomRight.x * (1 - k) + targetLocationRef.current.bottomRight.x * k,
              y: renderedLocationRef.current.bottomRight.y * (1 - k) + targetLocationRef.current.bottomRight.y * k,
            },
            bottomLeft: {
              x: renderedLocationRef.current.bottomLeft.x * (1 - k) + targetLocationRef.current.bottomLeft.x * k,
              y: renderedLocationRef.current.bottomLeft.y * (1 - k) + targetLocationRef.current.bottomLeft.y * k,
            },
            opacity: renderedLocationRef.current.opacity * (1 - k) + targetOpacity * k
          };
        }
        setQrLocation({ ...renderedLocationRef.current });
      } else {
        if (renderedLocationRef.current) {
          const k = 0.15; // Fade out rate
          const nextOpacity = renderedLocationRef.current.opacity * (1 - k);
          if (nextOpacity < 0.05) {
            renderedLocationRef.current = null;
            targetLocationRef.current = null;
            setQrLocation(null);
          } else {
            renderedLocationRef.current.opacity = nextOpacity;
            setQrLocation({ ...renderedLocationRef.current });
          }
        } else {
          setQrLocation(null);
        }
      }
    } else {
      setQrLocation(null);
    }

    requestRef.current = requestAnimationFrame(scanFrame);
  };

  const handleScannedCode = (decodedText: string) => {
    const parsed = parseChunk(decodedText);
    if (!parsed) {
      // Chunk corrupted or format invalid
      addLog('warning', 'Corrupted frame or non-system QR sequence detected.');
      return;
    }

    const { index, total, payload } = parsed;

    // Guard against wrong data or out-of-bounds index
    if (index < 0 || total < 1) {
      addLog('warning', `Received invalid block index: ${index}/${total}`);
      return;
    }

    // Check if chunk is already stored
    setCapturedChunks((prev) => {
      if (prev[index] !== undefined) {
        return prev; // No changes, avoid trigger of effects
      }

      // Trigger tactile haptic feedback click if enabled and supported by the device browser
      if (isHapticEnabledRef.current && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(60);
      }

      const updated = { ...prev };

      const now = Date.now();
      // Approximate bytes length: base64 characters * 3 / 4.
      const chunkBytes = Math.floor(payload.length * 3 / 4);
      bytesReceivedRef.current.push({ time: now, bytes: chunkBytes });

      const currentMetadata = metadataRef.current;
      if (currentMetadata) {
        // We already have file metadata, write payload to IndexedDB immediately and keep state clean
        const sessionId = `optgap:${currentMetadata.name}:${currentMetadata.size}:${currentMetadata.crc32}`;
        saveChunkToDB(sessionId, index, payload).catch(err => {
          console.error('IndexedDB write failed:', err);
        });
        updated[index] = ''; // Empty placeholder to indicate completion without memory bloat
        addLog('success', `Captured payload block ${index} of ${total} (Saved to persistent cache)`);
      } else {
        // No metadata yet. If this is index 0, we can extract metadata!
        if (index === 0) {
          const meta = parseMetadata(payload);
          if (meta) {
            setMetadata(meta);
            addLog('info', `Verified File Header: "${meta.name}" (${formatBytes(meta.size)})`);
            
            const sessionId = `optgap:${meta.name}:${meta.size}:${meta.crc32}`;
            
            // Save metadata chunk to IndexedDB
            saveChunkToDB(sessionId, 0, payload).catch(err => {
              console.error('IndexedDB write failed:', err);
            });
            updated[0] = payload;

            // Flush any previously deferred chunks to IndexedDB
            Object.entries(updated).forEach(([idxStr, chunkPayload]) => {
              const idx = Number(idxStr);
              const payloadStr = chunkPayload as string;
              if (idx > 0 && payloadStr !== '') {
                saveChunkToDB(sessionId, idx, payloadStr).catch(err => {
                  console.error(`IndexedDB write failed for deferred chunk ${idx}:`, err);
                });
                updated[idx] = ''; // Free memory
              }
            });

            // Auto-restore any matching saved progress from previous sessions
            try {
              const savedStr = localStorage.getItem('optgap:active-sessions');
              const sessions: SavedSession[] = savedStr ? JSON.parse(savedStr) : [];
              const existing = sessions.find(s => s.sessionId === sessionId);
              if (existing && existing.completedIndices.length > 0) {
                addLog('success', `Recovered previous progress! Merging ${existing.completedIndices.length} completed sectors.`);
                existing.completedIndices.forEach(existingIdx => {
                  if (updated[existingIdx] === undefined) {
                    updated[existingIdx] = '';
                  }
                });
              }
            } catch (e) {
              console.error(e);
            }
          } else {
            addLog('error', 'Critical metadata parse exception. Retry in progress.');
          }
        } else {
          // Defer data chunk payload in memory until we receive Chunk 0 metadata
          updated[index] = payload;
          addLog('success', `Captured payload block ${index} of ${total} (Deferred memory cache)`);
        }
      }

      return updated;
    });
  };

  // Synchronize active session progress to localStorage
  useEffect(() => {
    if (!metadata) return;

    const completedIndices = Object.keys(capturedChunks)
      .map(Number)
      .filter(idx => capturedChunks[idx] !== undefined);

    if (completedIndices.length > 0) {
      const sessionId = `optgap:${metadata.name}:${metadata.size}:${metadata.crc32}`;
      try {
        const savedSessionsStr = localStorage.getItem('optgap:active-sessions');
        let sessions: SavedSession[] = savedSessionsStr ? JSON.parse(savedSessionsStr) : [];
        
        sessions = sessions.filter(s => s.sessionId !== sessionId);
        sessions.push({
          sessionId,
          metadata,
          completedIndices,
          lastUpdated: Date.now()
        });
        localStorage.setItem('optgap:active-sessions', JSON.stringify(sessions));
        
        // Refresh landing list
        loadSavedSessions();
      } catch (err) {
        console.error('Failed to sync session progress:', err);
      }
    }
  }, [capturedChunks, metadata]);

  // Check if all chunks are collected
  useEffect(() => {
    if (!metadata || isVerifying) return;

    const totalChunksExpected = metadata.chunkCount;
    
    // We expect chunk 0 to exist AND chunk 1 up to totalChunksExpected to exist
    let allCollected = true;
    for (let i = 0; i <= totalChunksExpected; i++) {
      if (capturedChunks[i] === undefined) {
        allCollected = false;
        break;
      }
    }

    if (allCollected && isScanning) {
      setIsScanning(false);
      setIsVerifying(true);
      setVerificationProgress(0);
      setVerificationStatus('Spawning background CRC32 worker...');
      addLog('info', `All ${totalChunksExpected} segments harvested. Running Cyclic Redundancy Check (CRC32)...`);
      
      const sessionId = `optgap:${metadata.name}:${metadata.size}:${metadata.crc32}`;
      
      try {
        const valWorker = new Worker(
          new URL('../utils/receiver-validation.worker.ts', import.meta.url),
          { type: 'module' }
        );

        valWorker.onmessage = (e) => {
          const { type, ...payload } = e.data;

          if (type === 'VALIDATE_PROGRESS') {
            setVerificationProgress(payload.progress);
            setVerificationStatus(`Verifying blocks: ${payload.currentChunk} / ${payload.totalChunks}`);
          } else if (type === 'VALIDATE_COMPLETE') {
            const { computedCrc, expectedCrc, isMatched } = payload;

            if (isMatched) {
              // Trigger beautiful multi-pulse success haptic pattern
              if (isHapticEnabled && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                navigator.vibrate([100, 50, 100, 50, 150]);
              }

              addLog('success', `CRC32 verified successfully! [${computedCrc} === ${expectedCrc}]`);
              addLog('info', 'Reassembling segments and compiling binary file stream...');
              
              downloadFileFromDB(sessionId, metadata)
                .then(() => {
                  addLog('success', `Reconstructed binary package: "${metadata.name}" compiled and downloaded.`);
                })
                .catch((err) => {
                  addLog('error', `Download compilation failed: ${err.message}`);
                })
                .finally(() => {
                  // Clean up session storage
                  clearSession(sessionId);
                  loadSavedSessions();
                  setIsVerifying(false);
                  valWorker.terminate();
                });
            } else {
              // Trigger heavy alerting double buzz pattern for transfer/CRC mismatch failures
              if (isHapticEnabled && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                navigator.vibrate([300, 100, 300]);
              }

              addLog('error', `CRC32 MISMATCH DETECTED! Expected: [${expectedCrc}] but computed: [${computedCrc}]. Integrity check failed.`);
              setIsVerifying(false);
              valWorker.terminate();
            }
          } else if (type === 'VALIDATE_ERROR') {
            addLog('error', `Validation Worker error: ${payload.error || 'unknown calculation failure'}`);
            setIsVerifying(false);
            valWorker.terminate();
          }
        };

        valWorker.postMessage({
          type: 'VALIDATE_CRC',
          data: {
            sessionId,
            totalChunksExpected,
            expectedCrc: metadata.crc32
          }
        });

      } catch (workerErr: any) {
        addLog('warning', `Failed to spin up WebWorker. Falling back to inline validation.`);
        // Inline fallback (rare, only if browser strictly disallows modular workers)
        (async () => {
          try {
            const crcCalc = new CRC32();
            for (let i = 1; i <= totalChunksExpected; i++) {
              const payload = await getChunkFromDB(sessionId, i);
              if (payload === null) throw new Error(`Chunk ${i} missing`);
              crcCalc.update(payload);
              if (i % 5 === 0) {
                setVerificationProgress(Math.round((i / totalChunksExpected) * 100));
                setVerificationStatus(`Verifying blocks: ${i} / ${totalChunksExpected}`);
              }
            }
            const computedCrc = crcCalc.getValue();
            const expectedCrc = metadata.crc32;
            if (computedCrc === expectedCrc) {
              addLog('success', `CRC32 verified (fallback)!`);
              await downloadFileFromDB(sessionId, metadata);
              clearSession(sessionId);
              loadSavedSessions();
            } else {
              addLog('error', `CRC32 mismatch (fallback): [${computedCrc} !== ${expectedCrc}]`);
            }
          } catch (fallbackErr: any) {
            addLog('error', `Fallback failed: ${fallbackErr.message}`);
          } finally {
            setIsVerifying(false);
          }
        })();
      }
    }
  }, [capturedChunks, metadata, isScanning, isVerifying]);

  const handleReset = () => {
    setMetadata(null);
    setCapturedChunks({});
    setLogs([]);
    addLog('info', 'Decompressed state and index table wiped. Awaiting scanner initialization.');
  };

  // Grid Builder for the chunks
  const renderChunksGrid = () => {
    if (!metadata) {
      return (
        <div className="flex flex-col items-center justify-center p-8 bg-slate-50 border border-slate-100 rounded-2xl">
          <Activity className="w-8 h-8 text-slate-400 animate-pulse mb-3" />
          <p className="text-slate-500 text-sm font-medium">Awaiting metadata chunk (Index 0) to compute stream geometry...</p>
        </div>
      );
    }

    const grid = [];
    const totalCount = metadata.chunkCount;

    for (let i = 0; i <= totalCount; i++) {
      const isCaptured = capturedChunks[i] !== undefined;
      let badgeColor = 'bg-white border-slate-200 text-slate-400 shadow-sm';
      if (isCaptured) {
        badgeColor = i === 0 
          ? 'bg-amber-100 border-amber-200 text-amber-700 font-bold' 
          : 'bg-indigo-50 border-indigo-200 text-indigo-600 font-bold';
      }

      grid.push(
        <div
          key={i}
          className={`aspect-square flex items-center justify-center text-[10px] font-sans border rounded-lg transition-all select-none ${badgeColor}`}
          title={i === 0 ? `Metadata Chunk` : `Data Chunk ${i}`}
        >
          {i}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center border-b border-slate-100 pb-3">
          <span className="text-slate-800 text-sm uppercase tracking-wide font-bold">Geometry Data Map</span>
          <span className="text-xs font-bold text-slate-500">
            <span className="text-indigo-600">{Object.keys(capturedChunks).length}</span> / {totalCount + 1} BLOCK SECTORS
          </span>
        </div>
        <div className="grid grid-cols-6 sm:grid-cols-10 md:grid-cols-12 gap-2 max-h-[180px] overflow-y-auto p-3 border border-slate-100 bg-slate-50/50 rounded-2xl scrollbar-thin">
          {grid}
        </div>
      </div>
    );
  };

  const getPercentage = () => {
    if (!metadata) return 0;
    const totalCount = metadata.chunkCount + 1; // including chunk 0
    const capturedCount = Object.keys(capturedChunks).length;
    return Math.round((capturedCount / totalCount) * 100);
  };

  return (
    <div className="max-w-7xl mx-auto py-6 sm:py-12 px-4 sm:px-12 animate-fade-in font-sans space-y-6 sm:space-y-8">
      <div className="text-center mb-4">
        <h2 className="text-4xl font-display font-bold text-slate-900 tracking-tight mb-3">Receiver Scanner</h2>
        <p className="text-slate-500">
          Point your camera at a transmitting screen to capture and assemble the optical sequence.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
        {/* Left Column: Viewfinder camera feed */}
        <div className="lg:col-span-6 flex flex-col gap-6">
          <div className="w-full border border-slate-200 bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-8 relative overflow-hidden flex flex-col items-center shadow-sm">
            {/* Hidden Canvas used for frame processing */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Video Feed */}
            <div className="relative w-full max-w-md aspect-[4/3] sm:aspect-video lg:aspect-[4/3] bg-slate-900 border-4 sm:border-[8px] border-slate-900 rounded-2xl sm:rounded-3xl overflow-hidden flex items-center justify-center mx-auto shadow-2xl shadow-indigo-900/10">
              {/* Viewfinder Target Reticle - strictly inside the viewfinder to prevent overlapping layout anomalies */}
              <div className="absolute top-4 left-4 w-8 h-8 border-t-4 border-l-4 rounded-tl-xl border-indigo-500 z-10 animate-pulse opacity-50"></div>
              <div className="absolute top-4 right-4 w-8 h-8 border-t-4 border-r-4 rounded-tr-xl border-indigo-500 z-10 animate-pulse opacity-50"></div>
              <div className="absolute bottom-4 left-4 w-8 h-8 border-b-4 border-l-4 rounded-bl-xl border-indigo-500 z-10 animate-pulse opacity-50"></div>
              <div className="absolute bottom-4 right-4 w-8 h-8 border-b-4 border-r-4 rounded-br-xl border-indigo-500 z-10 animate-pulse opacity-50"></div>

              <video
                ref={videoRef}
                className={`w-full h-full object-cover rounded-xl ${isScanning ? '' : 'hidden'}`}
                muted
                playsInline
              />

              {!isScanning && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 bg-slate-900">
                  <Camera className="w-16 h-16 text-indigo-400 mb-4 animate-pulse opacity-50" />
                  {cameras.length === 0 ? (
                    <>
                      <p className="text-white font-display font-bold text-lg mb-1 tracking-wide">Hardware Access Required</p>
                      <p className="text-sm text-slate-400 max-w-xs mb-6">
                        Secure optical receiver needs permission to access your device camera.
                      </p>
                      <button
                        type="button"
                        onClick={forceRequestPermission}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm tracking-wider py-3 px-6 rounded-xl shadow-lg cursor-pointer transition-all hover:scale-105"
                      >
                        Grant Permissions
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-white font-display font-bold text-lg mb-1 tracking-wide">Awaiting Scanner Activation</p>
                      <p className="text-sm text-slate-400 max-w-xs">
                        Press Activate Scanner to initialize the secure sandbox capture loop.
                      </p>
                    </>
                  )}
                </div>
              )}

              {/* Target Tracker Selection Feedback Overlay */}
              {isScanning && qrLocation && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none z-30">
                  {/* Glowing semi-transparent polygon over the QR code */}
                  <polygon
                    points={`${qrLocation.topLeft.x},${qrLocation.topLeft.y} ${qrLocation.topRight.x},${qrLocation.topRight.y} ${qrLocation.bottomRight.x},${qrLocation.bottomRight.y} ${qrLocation.bottomLeft.x},${qrLocation.bottomLeft.y}`}
                    fill={isLaserLockReceiverActive ? `rgba(239, 68, 68, ${0.15 * qrLocation.opacity})` : `rgba(99, 102, 241, ${0.18 * qrLocation.opacity})`}
                    stroke={isLaserLockReceiverActive ? `rgba(239, 68, 68, ${qrLocation.opacity})` : `rgba(79, 70, 229, ${qrLocation.opacity})`}
                    strokeWidth={isLaserLockReceiverActive ? "4" : "3.5"}
                    strokeLinejoin="round"
                    className="shadow-lg"
                    style={{ transition: 'fill 100ms, stroke 100ms' }}
                  />

                  {/* Corner Target brackets */}
                  {isLaserLockReceiverActive ? (
                    <>
                      {/* Top Left corner brackets */}
                      <path
                        d={`M ${qrLocation.topLeft.x + (qrLocation.topRight.x - qrLocation.topLeft.x)*0.25} ${qrLocation.topLeft.y + (qrLocation.bottomLeft.y - qrLocation.topLeft.y)*0.25} L ${qrLocation.topLeft.x} ${qrLocation.topLeft.y} L ${qrLocation.topLeft.x + (qrLocation.bottomLeft.x - qrLocation.topLeft.x)*0.25} ${qrLocation.topLeft.y + (qrLocation.bottomLeft.y - qrLocation.topLeft.y)*0.25}`}
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth="4"
                        opacity={qrLocation.opacity}
                      />
                      {/* Top Right corner brackets */}
                      <path
                        d={`M ${qrLocation.topRight.x - (qrLocation.topRight.x - qrLocation.topLeft.x)*0.25} ${qrLocation.topRight.y + (qrLocation.bottomRight.y - qrLocation.topRight.y)*0.25} L ${qrLocation.topRight.x} ${qrLocation.topRight.y} L ${qrLocation.topRight.x - (qrLocation.topRight.x - qrLocation.bottomLeft.x)*0.25} ${qrLocation.topRight.y + (qrLocation.bottomRight.y - qrLocation.topRight.y)*0.25}`}
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth="4"
                        opacity={qrLocation.opacity}
                      />
                      {/* Bottom Right corner brackets */}
                      <path
                        d={`M ${qrLocation.bottomRight.x - (qrLocation.bottomRight.x - qrLocation.bottomLeft.x)*0.25} ${qrLocation.bottomRight.y - (qrLocation.bottomRight.y - qrLocation.topRight.y)*0.25} L ${qrLocation.bottomRight.x} ${qrLocation.bottomRight.y} L ${qrLocation.bottomRight.x - (qrLocation.bottomRight.x - qrLocation.bottomLeft.x)*0.25} ${qrLocation.bottomRight.y - (qrLocation.bottomRight.y - qrLocation.topRight.y)*0.25}`}
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth="4"
                        opacity={qrLocation.opacity}
                      />
                      {/* Bottom Left corner brackets */}
                      <path
                        d={`M ${qrLocation.bottomLeft.x + (qrLocation.bottomRight.x - qrLocation.bottomLeft.x)*0.25} ${qrLocation.bottomLeft.y - (qrLocation.bottomLeft.y - qrLocation.topLeft.y)*0.25} L ${qrLocation.bottomLeft.x} ${qrLocation.bottomLeft.y} L ${qrLocation.bottomLeft.x + (qrLocation.bottomRight.x - qrLocation.bottomLeft.x)*0.25} ${qrLocation.bottomLeft.y - (qrLocation.bottomLeft.y - qrLocation.topLeft.y)*0.25}`}
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth="4"
                        opacity={qrLocation.opacity}
                      />

                      {/* Concentric rotating radar rings and crosshair centering */}
                      {(() => {
                        const cx = (qrLocation.topLeft.x + qrLocation.topRight.x + qrLocation.bottomRight.x + qrLocation.bottomLeft.x) / 4;
                        const cy = (qrLocation.topLeft.y + qrLocation.topRight.y + qrLocation.bottomRight.y + qrLocation.bottomLeft.y) / 4;
                        const dx = qrLocation.topRight.x - qrLocation.topLeft.x;
                        const dy = qrLocation.topRight.y - qrLocation.topLeft.y;
                        const qrSize = Math.sqrt(dx * dx + dy * dy);
                        const r1 = qrSize * 0.45;
                        const r2 = qrSize * 0.22;
                        
                        return (
                          <>
                            {/* Outer targeting crosshair ring */}
                            <circle
                              cx={cx}
                              cy={cy}
                              r={r1}
                              fill="none"
                              stroke="rgba(239, 68, 68, 0.45)"
                              strokeWidth="2.5"
                              strokeDasharray="8 6"
                              className="animate-[spin_12s_linear_infinite]"
                              opacity={qrLocation.opacity}
                            />
                            {/* Inner targeting ring */}
                            <circle
                              cx={cx}
                              cy={cy}
                              r={r2}
                              fill="none"
                              stroke="rgba(239, 68, 68, 0.75)"
                              strokeWidth="2"
                              strokeDasharray="4 4"
                              className="animate-[spin_4s_linear_infinite]"
                              opacity={qrLocation.opacity}
                            />
                            {/* Center Target Lock Bullseye Dot */}
                            <circle
                              cx={cx}
                              cy={cy}
                              r="4"
                              fill="#ef4444"
                              className="animate-pulse"
                              opacity={qrLocation.opacity}
                            />

                            {/* Axis targeting grid crosshairs lines */}
                            <line x1={cx - r1 - 10} y1={cy} x2={cx - 10} y2={cy} stroke="rgba(239, 68, 68, 0.35)" strokeWidth="1.5" opacity={qrLocation.opacity} />
                            <line x1={cx + 10} y1={cy} x2={cx + r1 + 10} y2={cy} stroke="rgba(239, 68, 68, 0.35)" strokeWidth="1.5" opacity={qrLocation.opacity} />
                            <line x1={cx} y1={cy - r1 - 10} x2={cx} y2={cy - 10} stroke="rgba(239, 68, 68, 0.35)" strokeWidth="1.5" opacity={qrLocation.opacity} />
                            <line x1={cx} y1={cy + 10} x2={cx} y2={cy + r1 + 10} stroke="rgba(239, 68, 68, 0.35)" strokeWidth="1.5" opacity={qrLocation.opacity} />

                            {/* Neon target status tooltip tag */}
                            <g transform={`translate(${cx}, ${Math.min(qrLocation.topLeft.y, qrLocation.topRight.y) - 20})`} opacity={qrLocation.opacity}>
                              <rect x="-65" y="-12" width="130" height="18" rx="4" fill="#ef4444" className="shadow-lg animate-pulse" />
                              <text textAnchor="middle" fill="#ffffff" fontSize="8px" fontWeight="bold" fontFamily="monospace" dominantBaseline="middle">
                                LASER-LOCK DETECTED
                              </text>
                            </g>
                          </>
                        );
                      })()}
                    </>
                  ) : (
                    <>
                      {/* Standard Tracking elements */}
                      <circle cx={qrLocation.topLeft.x} cy={qrLocation.topLeft.y} r="6" fill="#4f46e5" fillOpacity={qrLocation.opacity * 0.4} className="animate-ping" />
                      <circle cx={qrLocation.topLeft.x} cy={qrLocation.topLeft.y} r="3" fill="#6366f1" fillOpacity={qrLocation.opacity} />

                      <circle cx={qrLocation.topRight.x} cy={qrLocation.topRight.y} r="6" fill="#4f46e5" fillOpacity={qrLocation.opacity * 0.4} className="animate-ping" />
                      <circle cx={qrLocation.topRight.x} cy={qrLocation.topRight.y} r="3" fill="#6366f1" fillOpacity={qrLocation.opacity} />

                      <circle cx={qrLocation.bottomRight.x} cy={qrLocation.bottomRight.y} r="6" fill="#4f46e5" fillOpacity={qrLocation.opacity * 0.4} className="animate-ping" />
                      <circle cx={qrLocation.bottomRight.x} cy={qrLocation.bottomRight.y} r="3" fill="#6366f1" fillOpacity={qrLocation.opacity} />

                      <circle cx={qrLocation.bottomLeft.x} cy={qrLocation.bottomLeft.y} r="6" fill="#4f46e5" fillOpacity={qrLocation.opacity * 0.4} className="animate-ping" />
                      <circle cx={qrLocation.bottomLeft.x} cy={qrLocation.bottomLeft.y} r="3" fill="#6366f1" fillOpacity={qrLocation.opacity} />

                      {/* "SECURE MATCH" status tooltip */}
                      <g 
                        transform={`translate(${(qrLocation.topLeft.x + qrLocation.topRight.x) / 2}, ${Math.min(qrLocation.topLeft.y, qrLocation.topRight.y) - 14})`}
                        opacity={qrLocation.opacity}
                        style={{ transition: 'opacity 100ms' }}
                      >
                        <rect
                          x="-55"
                          y="-12"
                          width="110"
                          height="18"
                          rx="4"
                          fill="#4f46e5"
                          className="opacity-95"
                        />
                        <text
                          textAnchor="middle"
                          fill="#ffffff"
                          fontSize="9px"
                          fontWeight="bold"
                          fontFamily="monospace"
                          dominantBaseline="middle"
                        >
                          SECURE MATCH
                        </text>
                      </g>
                    </>
                  )}
                </svg>
              )}

              {/* Glowing overlay lines */}
              {isScanning && (
                <div className="absolute inset-x-0 top-0 h-0.5 bg-indigo-600/40 animate-[scan_2.5s_ease-in-out_infinite] z-20 shadow-[0_0_12px_rgba(16,185,129,0.8)]"></div>
              )}
            </div>

             {/* Camera Controls Footer */}
            <div className="w-full mt-6 space-y-4">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <div className="flex items-center gap-3 flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 hover:border-indigo-200 transition-colors">
                  <Video className="w-5 h-5 text-indigo-500" />
                  <select
                    value={selectedCameraId}
                    onChange={(e) => setSelectedCameraId(e.target.value)}
                    className="flex-1 bg-transparent text-slate-700 text-sm focus:outline-none font-semibold truncate appearance-none"
                    disabled={cameras.length === 0}
                  >
                    {cameras.length > 0 ? (
                      cameras.map((cam) => (
                        <option key={cam.deviceId} value={cam.deviceId}>
                          {cam.label || `Camera Device ${cam.deviceId.substring(0, 5)}`}
                        </option>
                      ))
                    ) : (
                      <option value="">Awaiting hardware permissions...</option>
                    )}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={forceRequestPermission}
                  className="px-4 py-2 border-2 border-slate-200 hover:border-indigo-200 bg-white hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 rounded-xl cursor-pointer transition-all flex items-center justify-center gap-2 font-bold text-sm shadow-sm"
                >
                  <RefreshCw className="w-4 h-4" /> Reset Hardware
                </button>
              </div>

              {/* Camera Resolution & Density Tuning Selector */}
              <div className="border border-slate-200 rounded-xl p-4 bg-white shadow-sm space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500 font-bold uppercase tracking-wider flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-indigo-500" />
                    Optics Tuning
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 bg-indigo-600/10 text-indigo-500 rounded font-extrabold uppercase">
                    {scanResolutionMode === 'auto' ? 'Dynamic Auto' : scanResolutionMode === 'high-res' ? 'Ultra-Res (1080p)' : 'High-Speed (600p)'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1 bg-slate-50 p-1 rounded border border-slate-200 text-[10px] font-mono">
                  <button
                    type="button"
                    onClick={() => setScanResolutionMode('auto')}
                    className={`py-1 px-1.5 rounded text-center cursor-pointer font-bold uppercase tracking-wider transition-all ${
                      scanResolutionMode === 'auto'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'
                    }`}
                  >
                    Auto
                  </button>
                  <button
                    type="button"
                    onClick={() => setScanResolutionMode('high-res')}
                    className={`py-1 px-1.5 rounded text-center cursor-pointer font-bold uppercase tracking-wider transition-all ${
                      scanResolutionMode === 'high-res'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'
                    }`}
                  >
                    Ultra-Res
                  </button>
                  <button
                    type="button"
                    onClick={() => setScanResolutionMode('high-speed')}
                    className={`py-1 px-1.5 rounded text-center cursor-pointer font-bold uppercase tracking-wider transition-all ${
                      scanResolutionMode === 'high-speed'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'
                    }`}
                  >
                    High-Speed
                  </button>
                </div>
              </div>

              {/* Laser-Lock Tracking HUD Toggle */}
              <div className="flex items-center justify-between border-t border-slate-100 pt-2 px-0.5">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${isLaserLockReceiverActive ? 'bg-red-500 animate-pulse' : 'bg-slate-300'}`}></span>
                  Laser-Lock Targeting HUD
                </span>
                <button
                  type="button"
                  onClick={() => setIsLaserLockReceiverActive(!isLaserLockReceiverActive)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    isLaserLockReceiverActive ? 'bg-red-600' : 'bg-slate-200'
                  }`}
                  title="Toggle Laser-Lock targeting overlays"
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      isLaserLockReceiverActive ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Tactile Haptic Clicks toggle switch */}
              <div className="flex items-center justify-between border-t border-slate-100 pt-2 px-0.5">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${isHapticEnabled ? 'bg-indigo-600 animate-pulse' : 'bg-slate-300'}`}></span>
                  Tactile Haptic Clicks
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const nextVal = !isHapticEnabled;
                    setIsHapticEnabled(nextVal);
                    try {
                      localStorage.setItem('optgap:haptic-enabled', String(nextVal));
                    } catch {}
                    if (nextVal && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                      navigator.vibrate([40]);
                    }
                  }}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    isHapticEnabled ? 'bg-indigo-600' : 'bg-slate-200'
                  }`}
                  title="Toggle Tactile Feedback"
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      isHapticEnabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {cameraError && (
                <div className="flex items-center gap-2 border border-red-500/20 bg-red-500/5 text-red-400 p-2.5 rounded text-[11px]">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{cameraError}</span>
                </div>
              )}

              <div className="flex gap-2 sm:gap-3">
                <button
                  onClick={handleToggleScanning}
                  className={`flex-1 py-3 sm:py-4 px-3 sm:px-6 rounded-xl sm:rounded-2xl font-display font-bold tracking-wide text-sm sm:text-base cursor-pointer transition-all flex items-center justify-center gap-2 sm:gap-3 shadow-sm hover:-translate-y-1 hover:shadow-md border ${
                    isScanning
                      ? 'bg-amber-100 hover:bg-amber-200 text-amber-900 border-amber-300'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-700'
                  }`}
                >
                  {isScanning ? (
                    <>
                      <Pause className="w-4 h-4 sm:w-5 sm:h-5 fill-amber-900" /> Deactivate Scanner
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-white" /> Activate Scanner
                    </>
                  )}
                </button>
                <button
                  onClick={handleReset}
                  className="px-4 sm:px-6 border-2 border-slate-200 hover:border-red-200 bg-white hover:bg-red-50 text-slate-500 hover:text-red-600 rounded-xl sm:rounded-2xl cursor-pointer transition-all shadow-sm flex items-center justify-center"
                  title="Wipe Session Data"
                >
                  <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              </div>
            </div>

            {/* Live Stats Diagnostics */}
            <div className="w-full border border-slate-200 bg-white p-6 rounded-2xl sm:rounded-3xl space-y-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
                    <Activity className="w-5 h-5" />
                  </div>
                  <h4 className="text-lg font-display font-bold text-slate-900 tracking-tight">Live Diagnostics</h4>
                </div>
                <div className="px-3 py-1.5 bg-indigo-50 rounded-full border border-indigo-100 flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-500 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-600"></span>
                  </span>
                  <span className="text-xs text-indigo-700 font-bold uppercase tracking-wider">
                    {transferSpeed.toFixed(3)} MB/s
                  </span>
                </div>
              </div>
            </div>

            {/* Auto-Correction Status Card */}
            <div className="w-full border border-slate-200 bg-white p-6 rounded-2xl sm:rounded-3xl space-y-4 shadow-sm">
              <div className="flex items-center justify-between pb-2">
                <div className="flex items-center gap-3">
                  <div className="p-1.5 bg-emerald-50 rounded-lg text-emerald-500">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Auto-Correction Active</h4>
                </div>
                <span className="px-3 py-1 bg-emerald-50 text-emerald-600 font-bold text-xs rounded-full border border-emerald-100">
                  ECC L-H (30%)
                </span>
              </div>
              <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl text-xs leading-relaxed space-y-2">
                <p className="text-slate-700 font-semibold mb-2">
                  Reed-Solomon Optical Auto-Correction & Data Auto-Healing Active
                </p>
                <div className="flex gap-2 text-slate-600">
                  <span className="text-indigo-500 mt-0.5">•</span>
                  <span><strong className="text-slate-800">30% Matrix Damage Recovery:</strong> Reconstructs full frame payload even if camera glare, lens distortion, or partial screen blockage occurs.</span>
                </div>
                <div className="flex gap-2 text-slate-600">
                  <span className="text-indigo-500 mt-0.5">•</span>
                  <span><strong className="text-slate-800">Automatic Parity Validation:</strong> Every frame carries high-density polynomial check bytes for instant on-the-fly checksum verification.</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Real-time Stats & Chunk Map */}
        <div className="lg:col-span-6 space-y-6">
          {/* Metadata Card */}
          <div className="border border-slate-200 bg-white p-6 sm:p-8 rounded-2xl sm:rounded-3xl space-y-6 shadow-sm">
            <div className="flex justify-between items-center pb-4 border-b border-slate-100">
              <h3 className="text-lg font-display font-bold text-slate-900 tracking-tight">Optical Payload Profile</h3>
              <div className="flex items-center gap-2">
                <span className={`px-4 py-1.5 rounded-full text-xs uppercase font-bold tracking-widest ${
                  isVerifying
                    ? 'bg-amber-100 text-amber-700 border border-amber-200'
                    : metadata 
                      ? 'bg-indigo-100 text-indigo-700 border border-indigo-200' 
                      : 'bg-slate-100 text-slate-500 border border-slate-200'
                }`}>
                  {isVerifying ? 'VERIFYING CRC' : metadata ? 'HEADER RECEIVED' : 'LISTENING...'}
                </span>
              </div>
            </div>

            {metadata ? (
              <div className="space-y-6">
                <div>
                  <span className="text-slate-400 font-semibold uppercase tracking-wider block text-xs mb-1">Reconstructed Filename</span>
                  <span className="text-2xl font-display font-bold text-slate-900 break-all">{metadata.name}</span>
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <span className="text-slate-400 font-semibold uppercase tracking-wider block text-[10px] mb-1">Computed Size</span>
                    <span className="text-xl font-display font-bold text-slate-800">{formatBytes(metadata.size)}</span>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 overflow-hidden">
                    <span className="text-slate-400 font-semibold uppercase tracking-wider block text-[10px] mb-1">MIME Class</span>
                    <span className="text-lg font-display font-bold text-slate-800 uppercase truncate block">{metadata.type || 'RAW/BIN'}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 bg-slate-50 rounded-xl border border-slate-100">
                <p className="text-sm text-slate-500 font-medium max-w-sm mx-auto">
                  Point camera at the animated sequence grid to auto-detect header metadata.
                </p>
              </div>
            )}

            {/* Total progress bar */}
            <div className="space-y-3 pt-4 border-t border-slate-100">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-slate-400 uppercase tracking-wider">{isVerifying ? (verificationStatus || 'HASH SUM CALCULATION') : 'PACKET HARVEST DENSITY'}</span>
                <span className={isVerifying ? 'text-amber-500 animate-pulse text-lg font-display font-bold' : 'text-indigo-600 text-lg font-display font-bold'}>
                  {isVerifying ? `${verificationProgress}%` : `${getPercentage()}%`}
                </span>
              </div>
              <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden border border-slate-200">
                <div
                  className={`h-full transition-all duration-300 ${
                    isVerifying 
                      ? 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.5)]' 
                      : 'bg-indigo-500 shadow-[0_0_12px_rgba(99,102,241,0.5)]'
                  }`}
                  style={{ width: isVerifying ? `${verificationProgress}%` : `${getPercentage()}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* Saved Sessions Backlog */}
          {!metadata && savedSessions.length > 0 && (
            <div className="border border-slate-200 bg-white p-6 rounded-2xl sm:rounded-3xl space-y-4 shadow-sm">
              <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                <span className="text-sm font-bold text-slate-800 uppercase tracking-wide">Incomplete Transfers / Backlogs</span>
                <span className="text-[10px] px-2 py-1 bg-amber-50 text-amber-600 rounded font-extrabold animate-pulse uppercase tracking-widest">Resumable</span>
              </div>
              <div className="space-y-4 max-h-[260px] overflow-y-auto scrollbar-thin pr-2">
                {savedSessions.map((sess) => {
                  const total = sess.metadata.chunkCount + 1;
                  const completed = sess.completedIndices.length;
                  const pct = Math.round((completed / total) * 100);
                  return (
                    <div key={sess.sessionId} className="p-4 border border-slate-100 bg-slate-50/50 hover:bg-slate-50 rounded-2xl space-y-3 transition-colors">
                      <div className="flex justify-between items-start gap-3">
                        <div className="space-y-1 min-w-0">
                          <span className="font-bold text-slate-800 block truncate text-sm" title={sess.metadata.name}>{sess.metadata.name}</span>
                          <span className="text-xs text-slate-500 font-medium block">{formatBytes(sess.metadata.size)} • <span className="uppercase">{sess.metadata.type}</span></span>
                        </div>
                        <span className="text-indigo-600 font-display font-bold text-lg shrink-0">{pct}%</span>
                      </div>
                      <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                        <div className="bg-indigo-500 h-full transition-all duration-300" style={{ width: `${pct}%` }}></div>
                      </div>
                      <div className="flex justify-between items-center text-xs pt-2">
                        <span className="text-slate-500 font-medium">{completed} / {total} sectors</span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleResumeSession(sess)}
                            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-[10px] uppercase cursor-pointer transition-all shadow-sm"
                          >
                            Resume
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSession(sess.sessionId, sess.metadata.name)}
                            className="px-4 py-1.5 border-2 border-slate-200 hover:border-red-200 hover:bg-red-50 text-slate-600 hover:text-red-600 font-bold rounded-lg text-[10px] uppercase cursor-pointer transition-all"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Assembly grid */}
          <div className="border border-slate-200 bg-white p-6 sm:p-8 rounded-2xl sm:rounded-3xl shadow-sm">
            {renderChunksGrid()}
          </div>

          {/* Real-time Logger Terminal */}
          <div className="border border-slate-200 bg-white p-6 rounded-2xl sm:rounded-3xl space-y-4 shadow-sm">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <span className="text-sm font-bold text-slate-700 uppercase tracking-wide">Security Sandbox Logs</span>
              <span className="text-[10px] px-2 py-1 bg-slate-100 rounded text-slate-500 font-bold uppercase tracking-widest">LIVESTREAM</span>
            </div>

            <div className="max-h-[140px] overflow-y-auto space-y-2 font-mono text-[11px] bg-slate-50 p-4 rounded-xl border border-slate-100 leading-relaxed scrollbar-thin">
              {logs.length > 0 ? (
                logs.map((log) => (
                  <div key={log.id} className="flex gap-2 items-start text-slate-600 select-text">
                    <span className="text-slate-400 select-none font-semibold shrink-0">[{log.timestamp}]</span>
                    <span className={`shrink-0 select-none font-bold ${
                      log.type === 'success' ? 'text-indigo-600' :
                      log.type === 'warning' ? 'text-amber-500' :
                      log.type === 'error' ? 'text-red-500' : 'text-emerald-500'
                    }`}>
                      {log.type.toUpperCase()}:
                    </span>
                    <span className="text-slate-800">{log.message}</span>
                  </div>
                ))
              ) : (
                <div className="text-slate-400 text-center py-4 italic">
                  Warming diagnostic link logs...
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
