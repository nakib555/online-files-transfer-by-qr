/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Camera, CheckCircle2, AlertTriangle, RefreshCw, 
  Activity, Video, Download, Play, Pause, ListFilter
} from 'lucide-react';
import { FileMetadata, ReceiverLog, SavedSession } from '../types';
import { 
  parseChunk, parseMetadata, formatBytes, CRC32,
  saveChunkToDB, getChunkFromDB, clearSession, downloadFileFromDB 
} from '../utils/fileHelper';
import jsQR from 'jsqr';

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
  } | null>(null);
  const qrLocationTimeoutRef = useRef<any>(null);
  
  // Storage for chunks: key is chunk index, value is the base64 payload
  const [capturedChunks, setCapturedChunks] = useState<Record<number, string>>({});
  const [logs, setLogs] = useState<ReceiverLog[]>([]);
  const [cameraError, setCameraError] = useState<string>('');
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
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

  // Synchronize state values to refs to avoid event listener closures issues
  useEffect(() => {
    metadataRef.current = metadata;
  }, [metadata]);

  useEffect(() => {
    isHapticEnabledRef.current = isHapticEnabled;
  }, [isHapticEnabled]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (qrLocationTimeoutRef.current) {
        clearTimeout(qrLocationTimeoutRef.current);
      }
    };
  }, []);

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

      // Use safe, highly compatible, and performant HD constraints (1280x720 ideal)
      const standardResolution = {
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 }
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
    // Throttle: limit scanning to at most once every 60ms for amazing responsiveness without overhead
    if (now - lastScanTimeRef.current < 60) {
      requestRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
      lastScanTimeRef.current = now;

      let targetWidth = video.videoWidth;
      let targetHeight = video.videoHeight;

      // Scale down image to 720px max dimension for excellent balance of speed and high-density QR decoding accuracy!
      // This is crucial: 480px was too low for the high density QR code, but 720px is perfect.
      const maxDimension = 720;
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

      try {
        // Extract the pixel data
        const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);

        // Run jsQR decoding directly on the main thread
        const code = jsQR(imageData.data, targetWidth, targetHeight, {
          inversionAttempts: 'attemptBoth',
        });

        if (code) {
          if (code.data) {
            handleScannedCode(code.data);
          }

          // Compute target selection feedback location
          const location = code.location;
          if (location && videoRef.current) {
            const videoEl = videoRef.current;
            const containerWidth = videoEl.clientWidth;
            const containerHeight = videoEl.clientHeight;
            const videoWidth = videoEl.videoWidth;
            const videoHeight = videoEl.videoHeight;

            if (containerWidth && containerHeight && videoWidth && videoHeight) {
              const videoRatio = videoWidth / videoHeight;
              const containerRatio = containerWidth / containerHeight;

              let renderedWidth = containerWidth;
              let renderedHeight = containerHeight;
              let xOffset = 0;
              let yOffset = 0;

              if (containerRatio > videoRatio) {
                // Scaled to cover container width, top/bottom gets cropped
                renderedWidth = containerWidth;
                renderedHeight = containerWidth / videoRatio;
                yOffset = (containerHeight - renderedHeight) / 2;
              } else {
                // Scaled to cover container height, left/right gets cropped
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

              setQrLocation({
                topLeft: transformPoint(location.topLeftCorner),
                topRight: transformPoint(location.topRightCorner),
                bottomRight: transformPoint(location.bottomRightCorner),
                bottomLeft: transformPoint(location.bottomLeftCorner),
              });

              if (qrLocationTimeoutRef.current) {
                clearTimeout(qrLocationTimeoutRef.current);
              }
              qrLocationTimeoutRef.current = setTimeout(() => {
                setQrLocation(null);
              }, 180);
            }
          }
        }
      } catch (err) {
        console.error('Error during QR decoding:', err);
      }
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
      addLog('info', `All ${totalChunksExpected} segments harvested. Running Cyclic Redundancy Check (CRC32)...`);
      
      const sessionId = `optgap:${metadata.name}:${metadata.size}:${metadata.crc32}`;
      
      // Async verify and download
      (async () => {
        try {
          const crcCalc = new CRC32();
          // Sequentially calculate progressive CRC of chunks from IndexedDB
          for (let i = 1; i <= totalChunksExpected; i++) {
            const payload = await getChunkFromDB(sessionId, i);
            if (payload === null) {
              throw new Error(`Chunk segment ${i} is missing from cache database`);
            }
            crcCalc.update(payload);
          }

          const computedCrc = crcCalc.getValue();
          const expectedCrc = metadata.crc32;

          if (computedCrc === expectedCrc) {
            // Trigger beautiful multi-pulse success haptic pattern
            if (isHapticEnabled && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
              navigator.vibrate([100, 50, 100, 50, 150]);
            }

            addLog('success', `CRC32 verified successfully! [${computedCrc} === ${expectedCrc}]`);
            addLog('info', 'Reassembling segments and compiling binary file stream...');
            
            await downloadFileFromDB(sessionId, metadata);
            addLog('success', `Reconstructed binary package: "${metadata.name}" compiled and downloaded.`);
            
            // Clean up session storage
            clearSession(sessionId);
            loadSavedSessions();
          } else {
            // Trigger heavy alerting double buzz pattern for transfer/CRC mismatch failures
            if (isHapticEnabled && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
              navigator.vibrate([300, 100, 300]);
            }

            addLog('error', `CRC32 MISMATCH DETECTED! Expected: [${expectedCrc}] but computed: [${computedCrc}]. Integrity check failed.`);
          }
        } catch (err: any) {
          addLog('error', `Assembly/Verification error: ${err.message || 'corruption in data streams'}`);
        } finally {
          setIsVerifying(false);
        }
      })();
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
        <div className="flex flex-col items-center justify-center p-4 sm:p-8 border border-slate-200 bg-white/20 rounded-xl">
          <Activity className="w-8 h-8 text-slate-400 animate-pulse mb-3" />
          <p className="text-slate-500 text-xs">Awaiting metadata chunk (Index 0) to compute stream geometry...</p>
        </div>
      );
    }

    const grid = [];
    const totalCount = metadata.chunkCount;

    for (let i = 0; i <= totalCount; i++) {
      const isCaptured = capturedChunks[i] !== undefined;
      let badgeColor = 'bg-slate-50/50 border-slate-200 text-slate-400';
      if (isCaptured) {
        badgeColor = i === 0 
          ? 'bg-amber-500/20 border-amber-500/30 text-amber-400' 
          : 'bg-indigo-600/20 border-indigo-600/30 text-indigo-500 font-extrabold';
      }

      grid.push(
        <div
          key={i}
          className={`aspect-square flex items-center justify-center text-[10px] font-mono border rounded transition-all select-none ${badgeColor}`}
          title={i === 0 ? `Metadata Chunk` : `Data Chunk ${i}`}
        >
          {i}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-slate-500 text-[11px] uppercase tracking-wider font-bold">Geometry Data Map</span>
          <span className="text-[10px] text-slate-500">
            {Object.keys(capturedChunks).length} / {totalCount + 1} BLOCK SECTORS
          </span>
        </div>
        <div className="grid grid-cols-6 sm:grid-cols-10 md:grid-cols-12 gap-1.5 max-h-[160px] overflow-y-auto p-2 border border-slate-200 bg-white/60 rounded-xl scrollbar-thin">
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
    <div className="max-w-4xl mx-auto py-6 px-4 animate-fade-in font-mono">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-start">
        {/* Left Column: Viewfinder camera feed */}
        <div className="lg:col-span-6 flex flex-col gap-4">
          <div className="w-full border border-slate-200 bg-white rounded-2xl p-4 sm:p-5 relative overflow-hidden flex flex-col items-center">
            {/* Hidden Canvas used for frame processing */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Video Feed */}
            <div className="relative w-full max-w-md aspect-[4/3] sm:aspect-video lg:aspect-[4/3] bg-slate-50 border border-slate-200 rounded-xl overflow-hidden flex items-center justify-center mx-auto shadow-inner">
              {/* Viewfinder Target Reticle - strictly inside the viewfinder to prevent overlapping layout anomalies */}
              <div className="absolute top-4 left-4 w-6 h-6 border-t-2 border-l-2 border-indigo-600 z-10 animate-pulse"></div>
              <div className="absolute top-4 right-4 w-6 h-6 border-t-2 border-r-2 border-indigo-600 z-10 animate-pulse"></div>
              <div className="absolute bottom-4 left-4 w-6 h-6 border-b-2 border-l-2 border-indigo-600 z-10 animate-pulse"></div>
              <div className="absolute bottom-4 right-4 w-6 h-6 border-b-2 border-r-2 border-indigo-600 z-10 animate-pulse"></div>

              <video
                ref={videoRef}
                className={`w-full h-full object-cover rounded-xl ${isScanning ? '' : 'hidden'}`}
                muted
                playsInline
              />

              {!isScanning && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4 bg-slate-50">
                  <Camera className="w-12 h-12 text-indigo-500/80 mb-3 animate-pulse" />
                  {cameras.length === 0 ? (
                    <>
                      <p className="text-slate-700 font-bold text-xs uppercase tracking-wide">Camera Permission Required</p>
                      <p className="text-[10px] text-slate-500 mt-1 max-w-xs mb-3">
                        The secure optical receiver sandbox needs permission to access your device camera.
                      </p>
                      <button
                        type="button"
                        onClick={forceRequestPermission}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-[10px] uppercase tracking-wider py-1.5 px-3 rounded shadow-sm cursor-pointer transition-all hover:scale-105"
                      >
                        Grant Camera Permission
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-slate-500 font-bold text-xs uppercase tracking-wide">Awaiting Scanner Activation</p>
                      <p className="text-[10px] text-slate-500 mt-1 max-w-xs">
                        Press "ACTIVATE SCANNER" to initialize secure sandbox webcam capture loop.
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
                    fill="rgba(99, 102, 241, 0.18)"
                    stroke="#4f46e5"
                    strokeWidth="3.5"
                    strokeLinejoin="round"
                    className="animate-pulse shadow-lg"
                  />

                  {/* Tracking dot elements on the corners */}
                  <circle cx={qrLocation.topLeft.x} cy={qrLocation.topLeft.y} r="6" fill="#4f46e5" className="animate-ping" />
                  <circle cx={qrLocation.topLeft.x} cy={qrLocation.topLeft.y} r="3" fill="#6366f1" />

                  <circle cx={qrLocation.topRight.x} cy={qrLocation.topRight.y} r="6" fill="#4f46e5" className="animate-ping" />
                  <circle cx={qrLocation.topRight.x} cy={qrLocation.topRight.y} r="3" fill="#6366f1" />

                  <circle cx={qrLocation.bottomRight.x} cy={qrLocation.bottomRight.y} r="6" fill="#4f46e5" className="animate-ping" />
                  <circle cx={qrLocation.bottomRight.x} cy={qrLocation.bottomRight.y} r="3" fill="#6366f1" />

                  <circle cx={qrLocation.bottomLeft.x} cy={qrLocation.bottomLeft.y} r="6" fill="#4f46e5" className="animate-ping" />
                  <circle cx={qrLocation.bottomLeft.x} cy={qrLocation.bottomLeft.y} r="3" fill="#6366f1" />

                  {/* "SECURE MATCH" status tooltip attached to the top edge of the selection bounding box */}
                  <g transform={`translate(${(qrLocation.topLeft.x + qrLocation.topRight.x) / 2}, ${Math.min(qrLocation.topLeft.y, qrLocation.topRight.y) - 14})`}>
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
                </svg>
              )}

              {/* Glowing overlay lines */}
              {isScanning && (
                <div className="absolute inset-x-0 top-0 h-0.5 bg-indigo-600/40 animate-[scan_2.5s_ease-in-out_infinite] z-20 shadow-[0_0_12px_rgba(16,185,129,0.8)]"></div>
              )}
            </div>

            {/* Camera Controls Footer */}
            <div className="w-full mt-4 space-y-3">
              <div className="flex items-center gap-2">
                <Video className="w-4 h-4 text-slate-500" />
                <select
                  value={selectedCameraId}
                  onChange={(e) => setSelectedCameraId(e.target.value)}
                  className="flex-1 bg-slate-50 border border-slate-200 text-slate-700 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-indigo-600 tracking-wide font-mono select-none"
                  disabled={cameras.length === 0}
                >
                  {cameras.length > 0 ? (
                    cameras.map((cam) => (
                      <option key={cam.deviceId} value={cam.deviceId}>
                        {cam.label || `CAMERA ${cam.deviceId.substring(0, 5)}`}
                      </option>
                    ))
                  ) : (
                    <option value="">AWAITING HARDWARE GRANTS...</option>
                  )}
                </select>
                <button
                  type="button"
                  onClick={forceRequestPermission}
                  className="p-1.5 border border-slate-200 hover:border-indigo-500/30 bg-slate-50 hover:bg-indigo-50 text-slate-500 hover:text-indigo-600 rounded cursor-pointer transition-all"
                  title="Force Ask Camera Permissions"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
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

              <div className="flex gap-2">
                <button
                  onClick={handleToggleScanning}
                  className={`flex-1 py-3 px-4 rounded font-bold tracking-wider text-xs cursor-pointer transition-all flex items-center justify-center gap-2 ${
                    isScanning
                      ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/40'
                      : 'bg-indigo-600 text-white hover:bg-indigo-500 border border-indigo-600 font-extrabold'
                  }`}
                >
                  {isScanning ? (
                    <>
                      <Pause className="w-4 h-4 fill-amber-400 text-amber-400" /> DEACTIVATE SCANNER
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-white text-white" /> ACTIVATE SCANNER
                    </>
                  )}
                </button>
                <button
                  onClick={handleReset}
                  className="px-3 border border-slate-200 hover:border-red-500/30 bg-slate-50 text-slate-500 hover:text-red-400 rounded cursor-pointer transition-all"
                  title="Wipe Session Data"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Live Stats Diagnostics */}
            <div className="w-full border border-slate-200 bg-white p-4 sm:p-5 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-indigo-500" />
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide">Live Diagnostics</h4>
                </div>
                <div className="px-2 py-1 bg-slate-50 rounded border border-slate-200 flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-500 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-600"></span>
                  </span>
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest text-indigo-500">
                    {transferSpeed.toFixed(3)} MB/s
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Real-time Stats & Chunk Map */}
        <div className="lg:col-span-6 space-y-4">
          {/* Metadata Card */}
          <div className="border border-slate-200 bg-white p-4 sm:p-5 rounded-xl space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-200">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide">Optical Payload Profile</h3>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-[9px] uppercase tracking-widest ${
                  isVerifying
                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    : metadata 
                      ? 'bg-indigo-600/10 text-indigo-500 border border-indigo-600/20' 
                      : 'bg-slate-50 text-slate-500 border border-slate-200'
                }`}>
                  {isVerifying ? 'VERIFYING CRC' : metadata ? 'HEADER RECEIVED' : 'LISTENING...'}
                </span>
              </div>
            </div>

            {metadata ? (
              <div className="space-y-3">
                <div className="text-xs">
                  <span className="text-slate-500 uppercase tracking-wide block text-[10px]">RECONSTRUCTED FILENAME</span>
                  <span className="font-extrabold text-slate-900 break-all">{metadata.name}</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500 uppercase tracking-wide block text-[10px]">COMPUTED SIZE</span>
                    <span className="font-bold text-slate-700">{formatBytes(metadata.size)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 uppercase tracking-wide block text-[10px]">MIME CLASS</span>
                    <span className="font-bold text-slate-700 uppercase truncate block">{metadata.type}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-xs text-slate-500 font-mono">
                  Point camera at the animated sequence grid to auto-detect header metadata.
                </p>
              </div>
            )}

            {/* Total progress bar */}
            <div className="space-y-2 pt-1">
              <div className="flex justify-between text-[11px] font-bold">
                <span className="text-slate-500">{isVerifying ? 'HASH SUM CALCULATION' : 'PACKET HARVEST DENSITY'}</span>
                <span className={isVerifying ? 'text-amber-400 animate-pulse' : 'text-indigo-500'}>
                  {isVerifying ? 'COMPUTING...' : `${getPercentage()}%`}
                </span>
              </div>
              <div className="w-full bg-slate-50 h-2.5 rounded-full overflow-hidden border border-slate-200">
                <div
                  className={`h-full transition-all duration-300 ${
                    isVerifying 
                      ? 'bg-amber-500 animate-pulse w-full shadow-[0_0_10px_rgba(245,158,11,0.4)]' 
                      : 'bg-indigo-600 shadow-[0_0_10px_rgba(16,185,129,0.4)]'
                  }`}
                  style={{ width: isVerifying ? '100%' : `${getPercentage()}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* Saved Sessions Backlog */}
          {!metadata && savedSessions.length > 0 && (
            <div className="border border-slate-200 bg-white p-4 sm:p-5 rounded-xl space-y-3">
              <div className="flex justify-between items-center pb-1 border-b border-slate-200">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">Incomplete Transfers / Backlogs</span>
                <span className="text-[9px] text-amber-500 font-extrabold animate-pulse">RESUMABLE</span>
              </div>
              <div className="space-y-2.5 max-h-[220px] overflow-y-auto scrollbar-thin pr-1">
                {savedSessions.map((sess) => {
                  const total = sess.metadata.chunkCount + 1;
                  const completed = sess.completedIndices.length;
                  const pct = Math.round((completed / total) * 100);
                  return (
                    <div key={sess.sessionId} className="p-3 border border-slate-200 bg-slate-50/20 rounded-lg space-y-2 text-xs">
                      <div className="flex justify-between items-start gap-2">
                        <div className="space-y-0.5 min-w-0">
                          <span className="font-bold text-slate-700 block truncate" title={sess.metadata.name}>{sess.metadata.name}</span>
                          <span className="text-[10px] text-slate-500 block">{formatBytes(sess.metadata.size)} • {sess.metadata.type}</span>
                        </div>
                        <span className="text-indigo-500 font-bold shrink-0 font-mono">{pct}%</span>
                      </div>
                      <div className="w-full bg-white h-1.5 rounded-full overflow-hidden border border-slate-200">
                        <div className="bg-indigo-600 h-full transition-all duration-300" style={{ width: `${pct}%` }}></div>
                      </div>
                      <div className="flex justify-between items-center text-[10px] pt-1">
                        <span className="text-slate-500">{completed} / {total} sectors</span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleResumeSession(sess)}
                            className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded text-[9px] uppercase cursor-pointer transition-all"
                          >
                            Resume
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSession(sess.sessionId, sess.metadata.name)}
                            className="px-2 py-1 border border-slate-200 hover:border-red-500/30 text-slate-500 hover:text-red-400 font-bold rounded text-[9px] uppercase cursor-pointer transition-all"
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
          <div className="border border-slate-200 bg-white p-4 sm:p-5 rounded-xl">
            {renderChunksGrid()}
          </div>

          {/* Real-time Logger Terminal */}
          <div className="border border-slate-200 bg-white p-4 sm:p-5 rounded-xl space-y-3">
            <div className="flex justify-between items-center pb-1 border-b border-slate-200">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">Security Sandbox Activity Logs</span>
              <span className="text-[9px] text-slate-400">LIVESTREAM DATA</span>
            </div>

            <div className="max-h-[140px] overflow-y-auto space-y-1.5 font-mono text-[10px] bg-white/80 p-3 rounded-lg border border-slate-200/60 leading-relaxed scrollbar-thin">
              {logs.length > 0 ? (
                logs.map((log) => (
                  <div key={log.id} className="flex gap-2 items-start text-slate-500 select-text">
                    <span className="text-slate-400 select-none font-semibold shrink-0">[{log.timestamp}]</span>
                    <span className={`shrink-0 select-none ${
                      log.type === 'success' ? 'text-indigo-500' :
                      log.type === 'warning' ? 'text-amber-400' :
                      log.type === 'error' ? 'text-red-400' : 'text-cyan-400'
                    }`}>
                      {log.type.toUpperCase()}:
                    </span>
                    <span className="text-slate-700">{log.message}</span>
                  </div>
                ))
              ) : (
                <div className="text-slate-400 text-center py-4">
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
