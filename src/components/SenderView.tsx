/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, DragEvent } from 'react';
import { 
  Upload, Play, Pause, SkipForward, SkipBack, RefreshCw, 
  FileText, Sliders, Settings, Check, Zap, AlertCircle, ShieldCheck, FileArchive
} from 'lucide-react';
import { FileMetadata } from '../types';
import { formatBytes, calculateOptimalChunkSize } from '../utils/fileHelper';
import * as fflate from 'fflate';

export default function SenderView() {
  const [file, setFile] = useState<File | null>(null);
  const [batchCount, setBatchCount] = useState<number>(0);
  const [totalChunksCount, setTotalChunksCount] = useState<number>(0);
  const [computedCrc32, setComputedCrc32] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isRechunking, setIsRechunking] = useState<boolean>(false);
  const [processingProgress, setProcessingProgress] = useState<number>(0);
  const [processingStatus, setProcessingStatus] = useState<string>('');

  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [fps, setFps] = useState<number>(15);
  const [chunkSize, setChunkSize] = useState<number>(150);
  const [isAdaptiveEnabled, setIsAdaptiveEnabled] = useState<boolean>(true);
  const [adaptiveDetails, setAdaptiveDetails] = useState<string[]>([]);
  const [estQrVersion, setEstQrVersion] = useState<number>(10);
  const [pregenProgress, setPregenProgress] = useState<number>(-1);
  const [pregenIndex, setPregenIndex] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [qrError, setQrError] = useState<string>('');
  const [isLaserLockActive, setIsLaserLockActive] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState<number>(0);

  const workerRef = useRef<Worker | null>(null);
  const currentIndexRef = useRef<number>(0);
  const isLaserLockActiveRef = useRef<boolean>(false);

  // Sync currentIndex ref for the Worker event listener closure
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  // Sync laser lock ref for the Worker event listener closure
  useEffect(() => {
    isLaserLockActiveRef.current = isLaserLockActive;
  }, [isLaserLockActive]);

  // Handle active adaptive chunk size calculations based on file and device/screen conditions
  useEffect(() => {
    if (!file || !isAdaptiveEnabled) return;

    const handleResize = () => {
      const opt = calculateOptimalChunkSize(file.size, file.name, file.type);
      setChunkSize(opt.chunkSize);
      setAdaptiveDetails(opt.explanations);
      setEstQrVersion(opt.qrVersion);
    };

    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [file, isAdaptiveEnabled]);

  // Convert character payload size to byte chunk size as a multiple of 3
  const getByteChunkSize = (charsSize: number) => {
    const bytes = Math.floor((charsSize * 3) / 4);
    return Math.max(3, Math.floor(bytes / 3) * 3);
  };

  // Helper to draw raw QR code BitMatrix modules onto canvas
  const drawQRFrame = (index: number, size: number, data: Uint8Array) => {
    if (!canvasRef.current || index !== currentIndexRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const canvasSize = 1024;
    canvas.width = canvasSize;
    canvas.height = canvasSize;

    ctx.clearRect(0, 0, canvasSize, canvasSize);

    // Grid layout calculations
    const cellSize = Math.floor(canvasSize / size);
    const padding = (canvasSize - cellSize * size) / 2;

    // Background white
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    // Draw dark modules
    ctx.fillStyle = '#000000';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (data[r * size + c] === 1) {
          ctx.fillRect(
            padding + c * cellSize,
            padding + r * cellSize,
            cellSize,
            cellSize
          );
        }
      }
    }
    setQrError('');

  };

  // Initialize and manage the Web Worker life cycle
  useEffect(() => {
    const worker = new Worker(
      new URL('../utils/qr.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const { type, ...payload } = e.data;

      if (type === 'LOAD_PROGRESS') {
        setProcessingProgress(payload.progress);
        setProcessingStatus(payload.status);
      } else if (type === 'LOAD_COMPLETE') {
        setTotalChunksCount(payload.totalChunksCount);
        setComputedCrc32(payload.crc32);
        setIsProcessing(false);
        setIsRechunking(false);
        setCurrentIndex((prev) => Math.min(prev, payload.totalChunksCount));
      } else if (type === 'LOAD_ERROR') {
        console.error('Worker file load error:', payload.error);
        setIsProcessing(false);
        setIsRechunking(false);
        alert(`Worker failed to process file: ${payload.error}`);
      } else if (type === 'FRAME_READY') {
        drawQRFrame(payload.index, payload.size, payload.data);
      } else if (type === 'FRAME_ERROR') {
        console.error(`Worker frame error at index ${payload.index}:`, payload.error);
        setQrError(payload.error || 'QR generation failed');
      } else if (type === 'PREGEN_PROGRESS') {
        setPregenProgress(payload.progress);
        setPregenIndex(payload.index);
      }
    };

    return () => {
      worker.terminate();
    };
  }, []);

  const [debouncedChunkSize, setDebouncedChunkSize] = useState<number>(chunkSize);
  const lastFileRef = useRef<File | null>(null);

  // Debounce chunk size updates to enable butter-smooth slider interaction without UI lag
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedChunkSize(chunkSize);
    }, 250);
    return () => clearTimeout(handler);
  }, [chunkSize]);

  // Re-calculate chunks and offload CRC32 hashing & slicing to the Web Worker
  useEffect(() => {
    if (!file || !workerRef.current) return;

    const isNewFile = lastFileRef.current !== file;
    lastFileRef.current = file;

    if (isNewFile) {
      setIsProcessing(true);
    } else {
      // Re-chunking existing file - keep main controls mounted and just show a non-blocking indicator on the QR canvas
      setIsRechunking(true);
    }

    setProcessingProgress(0);
    setProcessingStatus('Re-chunking stream sequence...');
    setPregenProgress(0);
    setPregenIndex(0);
    handleReset();

    workerRef.current.postMessage({
      type: 'LOAD_FILE',
      data: { file, chunkSize: debouncedChunkSize }
    });
  }, [debouncedChunkSize, file]);

  // Handle active transmission interval using high-performance requestAnimationFrame
  useEffect(() => {
    if ((!isPlaying && !isLaserLockActive) || totalChunksCount === 0 || isProcessing) return;

    if (isPlaying && !startTimeRef.current) {
      startTimeRef.current = performance.now() - elapsedTime;
    }

    let animFrameId: number;
    let lastFrameTime = performance.now();
    
    const tick = (now: number) => {
      if (isPlaying) {
        const msPerFrame = 1000 / fps;
        const elapsedSinceLast = now - lastFrameTime;
        
        if (elapsedSinceLast >= msPerFrame) {
          const framesToAdvance = Math.floor(elapsedSinceLast / msPerFrame);
          setCurrentIndex((prev) => {
            const nextIdx = (prev + framesToAdvance) % (totalChunksCount + 1);
            return nextIdx;
          });
          
          lastFrameTime = now - (elapsedSinceLast % msPerFrame);
        }

        if (startTimeRef.current) {
          setElapsedTime(performance.now() - startTimeRef.current);
        }
      } else if (isLaserLockActive) {
        // Redraw current frame to animate the laser sweep smoothly at 60 FPS when paused
        const elapsedSinceLast = now - lastFrameTime;
        if (elapsedSinceLast >= 16.67) { // 60 FPS
          if (workerRef.current) {
            workerRef.current.postMessage({
              type: 'GENERATE_FRAME',
              data: {
                index: currentIndex,
                chunkSize,
                totalChunksCount,
                computedCrc32
              }
            });
          }
          lastFrameTime = now;
        }
      }

      animFrameId = requestAnimationFrame(tick);
    };

    animFrameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animFrameId);
    };
  }, [isPlaying, isLaserLockActive, fps, totalChunksCount, isProcessing, currentIndex, chunkSize, computedCrc32]);

  // Render QR Code onto canvas via the Web Worker when index or laser lock changes
  useEffect(() => {
    if (!file || totalChunksCount === 0 || isProcessing || !workerRef.current) return;

    workerRef.current.postMessage({
      type: 'GENERATE_FRAME',
      data: {
        index: currentIndex,
        chunkSize,
        totalChunksCount,
        computedCrc32
      }
    });
  }, [currentIndex, file, totalChunksCount, computedCrc32, chunkSize, isProcessing, isLaserLockActive]);

  const handleFileChange = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    
    if (files.length === 1) {
      setBatchCount(0);
      setFile(files[0]);
    } else {
      setIsProcessing(true);
      setProcessingStatus('Assembling Batch Queue...');
      setProcessingProgress(0);
      
      const zipData: Record<string, Uint8Array> = {};
      
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setProcessingStatus(`Zipping ${f.name} (${i + 1}/${files.length})`);
        setProcessingProgress(Math.round((i / files.length) * 50));
        const arrayBuffer = await f.arrayBuffer();
        zipData[f.name] = new Uint8Array(arrayBuffer);
      }
      
      setProcessingStatus('Compressing batch...');
      
      // We use async fflate zip to avoid blocking the main thread
      fflate.zip(zipData, { level: 0 }, (err, data) => {
        if (err) {
          console.error(err);
          setIsProcessing(false);
          return;
        }
        
        const blob = new Blob([data], { type: 'application/zip' });
        const batchFile = new File([blob], `batch_transfer_${files.length}_files.zip`, {
          type: 'application/zip',
          lastModified: Date.now(),
        });
        
        setBatchCount(files.length);
        setFile(batchFile);
        setIsProcessing(false);
      });
      return; // Return early because handleReset is handled when file changes, but wait, file change effect does re-chunking
    }
    handleReset();
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileChange(e.dataTransfer.files);
    }
  };

  const togglePlayback = () => {
    if (!isPlaying) {
      // Starting or resuming
      startTimeRef.current = Date.now() - elapsedTime;
    }
    setIsPlaying(!isPlaying);
  };

  const handleReset = () => {
    setIsPlaying(false);
    setCurrentIndex(0);
    setElapsedTime(0);
    startTimeRef.current = null;
  };

  const stepNext = () => {
    setIsPlaying(false);
    setCurrentIndex((prev) => (prev + 1 >= totalChunksCount + 1 ? 0 : prev + 1));
  };

  const stepPrev = () => {
    setIsPlaying(false);
    setCurrentIndex((prev) => (prev - 1 < 0 ? totalChunksCount : prev - 1));
  };

  const handlePreset = (selectedFps: number, selectedSize: number, laserLock = false) => {
    setIsAdaptiveEnabled(false);
    setFps(selectedFps);
    setChunkSize(selectedSize);
    setIsLaserLockActive(laserLock);
    handleReset();
  };

  const formatTimer = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = Math.floor((ms % 1000) / 100);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds}`;
  };

  return (
    <div className="max-w-7xl mx-auto py-8 px-6 sm:px-12 animate-fade-in font-sans">
      {isProcessing ? (
        <div className="max-w-md mx-auto border border-slate-200 bg-white p-8 sm:p-10 rounded-[2rem] flex flex-col items-center justify-center space-y-6 text-center shadow-xl shadow-indigo-900/5">
          <RefreshCw className="w-12 h-12 text-indigo-500 animate-spin" />
          <div className="space-y-4 w-full">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest">{processingStatus}</h3>
            <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden border border-slate-200">
              <div
                className="bg-indigo-500 h-full transition-all duration-300 shadow-[0_0_12px_rgba(99,102,241,0.5)]"
                style={{ width: `${processingProgress}%` }}
              ></div>
            </div>
            <span className="text-xs text-slate-500 font-bold block">{processingProgress}% Complete</span>
          </div>
        </div>
      ) : !file ? (
        <div className="space-y-8 max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-4xl font-display font-bold text-slate-900 tracking-tight mb-3">Transmitter Configuration</h2>
            <p className="text-slate-500">
              Select or drag a file to convert it into an optical sequence.
            </p>
          </div>

          {/* Drag & Drop File Upload Zone */}
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`border-2 border-dashed rounded-[2rem] p-16 flex flex-col items-center justify-center transition-all ${
              isDragging 
                ? 'border-indigo-500 bg-indigo-50 shadow-[0_0_40px_rgba(99,102,241,0.15)] scale-[1.02]' 
                : 'border-slate-200 bg-white hover:border-indigo-200 hover:shadow-lg'
            }`}
          >
            <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-6 transition-all ${isDragging ? 'bg-indigo-100 text-indigo-600 scale-110' : 'bg-slate-50 text-slate-400'}`}>
               <Upload className="w-10 h-10" />
            </div>
            <h3 className="text-xl font-display font-bold text-slate-900 mb-2">Drop your file here</h3>
            <p className="text-sm text-slate-500 mb-6 text-center max-w-sm">Support for any file format, converting into highly resilient QR frames</p>
            <label className="bg-slate-900 hover:bg-slate-800 text-white text-sm px-6 py-3 rounded-full font-semibold tracking-wide cursor-pointer transition-all shadow-md hover:shadow-xl hover:-translate-y-0.5">
              Select File Manually
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleFileChange(e.target.files);
                  }
                }}
              />
            </label>
          </div>

          {/* Quick Security Tip Box */}
          <div className="bg-indigo-50 border border-indigo-100 p-6 rounded-2xl flex gap-4 items-start shadow-sm">
            <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600 shrink-0">
               <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-indigo-900 mb-1">Optical Physics Engine</h4>
              <p className="text-sm text-indigo-700/80 leading-relaxed">
                We convert your file's bytes into low-density, high-contrast matrix patterns. At peak settings, this engine drives up to 240 visual frames per second for gigabit-speed offline transfer.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          {/* Left Column: QR Code Display Container */}
          <div className="lg:col-span-6 flex flex-col gap-6">
            <div className="w-full border border-slate-200 bg-white rounded-[2rem] p-6 sm:p-8 relative overflow-hidden flex flex-col items-center shadow-sm">
              {/* Corner Indicators */}
              <div className="absolute top-3 left-3 w-4 h-4 border-t-2 border-l-2 border-indigo-600/40"></div>
              <div className="absolute top-3 right-3 w-4 h-4 border-t-2 border-r-2 border-indigo-600/40"></div>
              <div className="absolute bottom-3 left-3 w-4 h-4 border-b-2 border-l-2 border-indigo-600/40"></div>
              <div className="absolute bottom-3 right-3 w-4 h-4 border-b-2 border-r-2 border-indigo-600/40"></div>

              {isRechunking && (
                <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-indigo-600 text-white text-[9px] font-bold px-2 py-0.5 rounded shadow-sm animate-pulse z-10">
                  <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                  RE-CONFIGURING MODULES...
                </div>
              )}

              {/* QR Canvas */}
              <div className="bg-white p-4 w-full max-w-md aspect-square rounded-[2rem] shadow-2xl shadow-indigo-900/5 relative flex justify-center items-center group border border-slate-100">
                {/* Non-Destructive Outer Laser-Lock Target Selection Outer Frame */}
                {isLaserLockActive && (
                  <div className="absolute -inset-3 pointer-events-none z-20 rounded-xl border-2 border-red-500/80 shadow-[0_0_25px_rgba(239,68,68,0.35)] transition-all duration-300">
                    {/* Glowing corner bracket elements */}
                    <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-red-500 rounded-tl-sm"></div>
                    <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-red-500 rounded-tr-sm"></div>
                    <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-red-500 rounded-bl-sm"></div>
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-red-500 rounded-br-sm"></div>
                    {/* Animated laser scanline sweeping outside canvas */}
                    <div className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-red-500 to-transparent shadow-[0_0_12px_#ef4444] animate-[bounce_2s_infinite]"></div>
                  </div>
                )}
                {totalChunksCount === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/80">
                    <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
                  </div>
                )}
                {qrError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/95 p-6 text-center z-20">
                    <AlertCircle className="w-10 h-10 text-red-500 mb-2 animate-bounce" />
                    <p className="text-red-600 font-bold text-xs uppercase tracking-wider">Payload Size Overflow</p>
                    <p className="text-[10px] text-slate-500 mt-2 max-w-[280px] leading-relaxed">
                      The current chunk size of <strong className="text-slate-800">{chunkSize} characters</strong> is too large to fit in a single QR frame.
                    </p>
                    <p className="text-[9px] text-indigo-500 mt-2 font-semibold">
                      Please select the GIGA, CYBER, or BALANCED preset below.
                    </p>
                  </div>
                )}
                <div className="w-full aspect-square relative flex items-center justify-center">
                  <canvas
                    id="qr-transmitter-canvas"
                    ref={canvasRef}
                    className="w-full h-full object-contain mx-auto"
                    style={{ imageRendering: 'pixelated', maxWidth: '100%', maxHeight: '100%' }}
                  />
                </div>
              </div>

              {/* Active frame label */}
              <div className="mt-4 flex items-center gap-3 sm:p-4 text-xs font-semibold">
                <span className="text-slate-500 bg-slate-50 border border-slate-200 px-2 py-1 rounded">
                  FRAME: <span className="text-slate-900">{currentIndex}</span> / {totalChunksCount}
                </span>
                <span className={`px-2 py-1 rounded uppercase tracking-wider text-[10px] ${
                  currentIndex === 0 
                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' 
                    : 'bg-indigo-600/10 text-indigo-500 border border-indigo-600/20'
                }`}>
                  {currentIndex === 0 ? 'METADATA HEADER' : 'PAYLOAD BLOCK'}
                </span>
              </div>
            </div>

            {/* Live Stats Diagnostics */}
            <div className="w-full border border-slate-200 bg-white p-6 sm:p-8 rounded-[2rem] space-y-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
                    <Zap className="w-5 h-5" />
                  </div>
                  <h4 className="text-lg font-display font-bold text-slate-900 tracking-tight">Live Diagnostics</h4>
                </div>
                <div className="px-3 py-1.5 bg-indigo-50 rounded-full border border-indigo-100 flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-500 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-600"></span>
                  </span>
                  <span className="text-xs text-indigo-700 font-bold uppercase tracking-wider">
                    {((fps * getByteChunkSize(chunkSize)) / 1024 / 1024).toFixed(3)} MB/s
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-1">
                  <span className="text-slate-400 block text-xs font-semibold uppercase tracking-wider">Elapsed Time</span>
                  <span className="text-3xl font-display font-bold text-slate-800">{formatTimer(elapsedTime)}</span>
                </div>
                <div className="space-y-1">
                  <span className="text-slate-400 block text-xs font-semibold uppercase tracking-wider">Est. Completion</span>
                  <span className="text-3xl font-display font-bold text-slate-400">
                    {totalChunksCount > 0 ? formatTimer(((totalChunksCount + 1) * 1000) / fps) : '00:00.0'}
                  </span>
                </div>
              </div>

              <div className="text-xs text-slate-500 bg-slate-50 p-4 rounded-xl border border-slate-100 leading-relaxed font-mono mt-4">
                <span className="text-indigo-600 font-bold block uppercase mb-2 tracking-wider">Optical Frame Blueprint</span>
                {totalChunksCount > 0 ? (
                  <span className="break-all opacity-80 block">
                    Streaming dynamically sliced binary payload at frame {currentIndex}...
                  </span>
                ) : (
                  <span>Awaiting file parsing telemetry...</span>
                )}
              </div>
            </div>

            {/* Playback Controls Panel */}
            <div className="w-full border border-slate-200 bg-white p-6 rounded-[2rem] flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-3">
                <button
                  onClick={stepPrev}
                  className="p-4 rounded-2xl bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 text-slate-500 hover:text-indigo-600 transition-all cursor-pointer shadow-sm hover:shadow"
                  title="Previous Frame"
                >
                  <SkipBack className="w-6 h-6" />
                </button>
                <button
                  onClick={togglePlayback}
                  className={`px-10 py-4 rounded-2xl flex items-center gap-3 font-display font-bold tracking-wide cursor-pointer text-base transition-all shadow-md hover:shadow-xl hover:-translate-y-1 border ${
                    isPlaying
                      ? 'bg-amber-100 hover:bg-amber-200 text-amber-900 border-amber-300'
                      : 'bg-indigo-600 text-white hover:bg-indigo-500 border-indigo-700'
                  }`}
                >
                  {isPlaying ? (
                    <>
                      <Pause className="w-5 h-5 fill-amber-900" /> Pause Transfer
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5 fill-white" /> Start Transfer
                    </>
                  )}
                </button>
                <button
                  onClick={stepNext}
                  className="p-4 rounded-2xl bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 text-slate-500 hover:text-indigo-600 transition-all cursor-pointer shadow-sm hover:shadow"
                  title="Next Frame"
                >
                  <SkipForward className="w-6 h-6" />
                </button>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleReset}
                  className="p-4 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-400 hover:text-slate-600 transition-all cursor-pointer"
                  title="Reset Sequence"
                >
                  <RefreshCw className="w-5 h-5" />
                </button>
                <button
                  onClick={() => {
                    setFile(null);
                    setTotalChunksCount(0);
                    setComputedCrc32('');
                  }}
                  className="text-sm font-bold border-2 border-slate-200 hover:border-red-200 bg-white text-slate-500 hover:bg-red-50 hover:text-red-600 px-6 py-4 rounded-2xl transition-colors cursor-pointer"
                >
                  Eject Media
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: File Details & Transmission Tuning Panel */}
          <div className="lg:col-span-6 space-y-6">
            {/* File Info Card */}
            <div className="border border-slate-200 bg-white p-6 sm:p-8 rounded-[2rem] space-y-6 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl text-indigo-600">
                  {batchCount > 0 ? <FileArchive className="w-6 h-6" /> : <FileText className="w-6 h-6" />}
                </div>
                <div className="overflow-hidden flex-1">
                  <h3 className="text-xl font-display font-bold text-slate-900 truncate">
                    {batchCount > 0 ? `Batch Transfer (${batchCount} Files)` : file.name}
                  </h3>
                  <p className="text-sm text-slate-500 mt-1 uppercase tracking-wider font-semibold">{file.type || 'UNKNOWN/RAW'}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                <div className="bg-slate-50 border border-slate-100 px-4 py-3 rounded-xl">
                  <span className="text-xs text-slate-400 font-semibold block uppercase tracking-wider mb-1">Total Size</span>
                  <span className="text-lg font-display font-bold text-slate-800">{formatBytes(file.size)}</span>
                </div>
                <div className="bg-slate-50 border border-slate-100 px-4 py-3 rounded-xl">
                  <span className="text-xs text-slate-400 font-semibold block uppercase tracking-wider mb-1">Chunks Total</span>
                  <span className="text-lg font-display font-bold text-slate-800">{totalChunksCount + 1}</span>
                </div>
              </div>

              {/* Progress Indicator Track */}
              <div className="space-y-3 pt-2">
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-slate-400 uppercase tracking-wider">Transmission Progress</span>
                  <span className="text-indigo-600 text-lg font-display font-bold">
                    {totalChunksCount > 0 ? Math.round((currentIndex / totalChunksCount) * 100) : 0}%
                  </span>
                </div>
                <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden border border-slate-200">
                  <div
                    className="h-full transition-all duration-300 bg-indigo-500 shadow-[0_0_12px_rgba(99,102,241,0.5)]"
                    style={{ width: `${totalChunksCount > 0 ? Math.round((currentIndex / totalChunksCount) * 100) : 0}%` }}
                  ></div>
                </div>
              </div>

              {/* WebWorker Pre-rendering Progress */}
              {pregenProgress >= 0 && (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-3">
                  <div className="flex justify-between items-center font-bold">
                    <span className="text-slate-500 uppercase tracking-wider flex items-center gap-2 text-xs">
                      <span className="relative flex h-2.5 w-2.5">
                        {pregenProgress < 100 ? (
                          <>
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500"></span>
                          </>
                        ) : (
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                        )}
                      </span>
                      {pregenProgress < 100 ? 'Caching Frames...' : 'Cache Ready'}
                    </span>
                    <span className={pregenProgress < 100 ? 'text-indigo-600 font-display font-bold animate-pulse text-lg' : 'text-emerald-500 font-display font-bold text-lg'}>
                      {pregenProgress}%
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${pregenProgress < 100 ? 'bg-indigo-500' : 'bg-emerald-500'}`}
                      style={{ width: `${pregenProgress}%` }}
                    ></div>
                  </div>
                  <p className="text-xs text-slate-500 font-medium leading-relaxed">
                    {pregenProgress < 100 
                      ? `Asynchronously pre-rendering optical matrix ${pregenIndex}/${totalChunksCount}.` 
                      : `All ${totalChunksCount + 1} optical frames pre-compiled into memory cache for latency-free playback.`
                    }
                  </p>
                </div>
              )}
            </div>

            {/* Auto-Adaptive Calibration Dashboard */}
            <div className="border border-slate-200 bg-white p-6 sm:p-8 rounded-[2rem] space-y-6 shadow-sm">
              <div className="flex items-center justify-between pb-2">
                <div className="flex items-center gap-3">
                  <div className="p-1.5 bg-indigo-50 border border-indigo-100 rounded-lg text-indigo-500">
                    <Zap className="w-5 h-5" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Auto-Adaptive Tuning</h4>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const nextVal = !isAdaptiveEnabled;
                    setIsAdaptiveEnabled(nextVal);
                    if (nextVal) {
                      const opt = calculateOptimalChunkSize(file.size, file.name, file.type);
                      setChunkSize(opt.chunkSize);
                      setAdaptiveDetails(opt.explanations);
                      setEstQrVersion(opt.qrVersion);
                    }
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none shadow-sm ${
                    isAdaptiveEnabled ? 'bg-indigo-600' : 'bg-slate-200'
                  }`}
                  title="Toggle Auto-Adaptive Optimal Tuning"
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      isAdaptiveEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {isAdaptiveEnabled ? (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl text-xs space-y-3 leading-relaxed">
                    <div className="flex items-center justify-between text-indigo-600 font-bold mb-1">
                      <span className="text-sm">CALIBRATION ACTIVE</span>
                      <span className="px-2 py-1 bg-indigo-600 text-white text-[10px] rounded uppercase shadow-sm">OPTIMIZED</span>
                    </div>
                    <p className="text-slate-600 font-sans font-medium text-sm">
                      Automatically calibrating optimal block densities for maximum scan integrity on low-end cameras.
                    </p>
                    <div className="border-t border-slate-200 pt-3 space-y-2 mt-2">
                      {adaptiveDetails.map((detail, idx) => (
                        <div key={idx} className="flex gap-2 items-start text-slate-600 text-sm">
                          <span className="text-indigo-500 select-none font-bold">•</span>
                          <span>{detail}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                    <div className="p-3 border border-slate-100 bg-slate-50 rounded-xl">
                      <span className="text-slate-400 block uppercase font-sans font-semibold mb-1">RECOMMENDED VERSION</span>
                      <span className="font-extrabold text-slate-800 text-sm">QR Ver. {estQrVersion} ({estQrVersion * 4 + 17}x{estQrVersion * 4 + 17})</span>
                    </div>
                    <div className="p-3 border border-slate-100 bg-slate-50 rounded-xl">
                      <span className="text-slate-400 block uppercase font-sans font-semibold mb-1">COMPATIBILITY</span>
                      <span className="font-extrabold text-indigo-600 text-sm">100% SECURE MATCH</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 border-2 border-dashed border-slate-200 bg-slate-50 rounded-xl text-xs leading-relaxed text-slate-500">
                  <p className="font-sans font-medium">
                    Auto-Adaptive Tuning is currently <span className="font-bold text-slate-700">DISABLED</span>. You are using manual settings.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAdaptiveEnabled(true);
                      const opt = calculateOptimalChunkSize(file.size, file.name, file.type);
                      setChunkSize(opt.chunkSize);
                      setAdaptiveDetails(opt.explanations);
                      setEstQrVersion(opt.qrVersion);
                    }}
                    className="mt-3 inline-block px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 font-bold uppercase tracking-wide cursor-pointer transition-colors"
                  >
                    ⚡ RESTORE AUTO-ADAPTIVE TUNING
                  </button>
                </div>
              )}
            </div>

            {/* Laser-Lock Targeting Feedback System */}
            <div className="border border-slate-200 bg-white p-6 sm:p-8 rounded-[2rem] space-y-4 shadow-sm">
              <div className="flex items-center justify-between pb-2">
                <div className="flex items-center gap-3">
                  <div className={`p-1.5 rounded-lg ${isLaserLockActive ? 'bg-red-50 text-red-500' : 'bg-slate-50 text-slate-400'}`}>
                    <div className={`w-5 h-5 rounded-full border-4 ${isLaserLockActive ? 'border-red-500 animate-pulse' : 'border-slate-300'}`}></div>
                  </div>
                  <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Laser-Lock Optical Link</h4>
                </div>
                <button
                  type="button"
                  onClick={() => setIsLaserLockActive(!isLaserLockActive)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none shadow-sm ${
                    isLaserLockActive ? 'bg-red-500' : 'bg-slate-200'
                  }`}
                  title="Toggle Laser-Lock Target Selection Feedback"
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      isLaserLockActive ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {isLaserLockActive ? (
                <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-xs space-y-2 leading-relaxed">
                  <div className="flex items-center justify-between text-red-600 font-bold mb-1">
                    <span className="text-sm">TARGETING ACTIVE</span>
                    <span className="px-2 py-1 bg-red-100 text-red-700 text-[10px] rounded uppercase animate-pulse shadow-sm border border-red-200">OUTER FRAME LOCK</span>
                  </div>
                  <p className="text-slate-600 font-sans font-medium text-sm">
                    Projecting non-destructive outer laser-lock guide brackets around the canvas border for camera alignment without obscuring QR modules.
                  </p>
                </div>
              ) : (
                <div className="p-4 border-2 border-dashed border-slate-200 bg-slate-50 rounded-xl text-xs leading-relaxed text-slate-500 font-sans">
                  <p className="font-medium text-sm">
                    Laser-Lock optical guidance is currently offline. Enable to show outer alignment brackets around the QR canvas.
                  </p>
                </div>
              )}
            </div>

            {/* Auto-Correction Status Card */}
            <div className="border border-slate-200 bg-white p-6 sm:p-8 rounded-[2rem] space-y-4 shadow-sm">
              <div className="flex items-center justify-between pb-2">
                <div className="flex items-center gap-3">
                  <div className="p-1.5 bg-emerald-50 rounded-lg text-emerald-500">
                    <ShieldCheck className="w-5 h-5" />
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
                  <span className="text-indigo-500 mt-0.5 font-bold">•</span>
                  <span><strong className="text-slate-800">30% Matrix Damage Recovery:</strong> Reconstructs full frame payload even if camera glare, lens distortion, or partial screen blockage occurs.</span>
                </div>
                <div className="flex gap-2 text-slate-600">
                  <span className="text-indigo-500 mt-0.5 font-bold">•</span>
                  <span><strong className="text-slate-800">Automatic Parity Validation:</strong> Every frame carries high-density polynomial check bytes for instant on-the-fly checksum verification.</span>
                </div>
              </div>
            </div>

            {/* Transmission Presets Configuration */}
            <div className="border border-slate-200 bg-white p-6 sm:p-8 rounded-[2rem] space-y-6 shadow-sm">
              <div className="flex items-center gap-3 pb-2">
                <div className="p-1.5 bg-indigo-50 rounded-lg text-indigo-500">
                  <Sliders className="w-5 h-5" />
                </div>
                <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Optical Presets</h4>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
                <button
                  type="button"
                  onClick={() => handlePreset(240, 2000, true)}
                  className={`p-3 rounded-xl border-2 text-left cursor-pointer transition-all ${
                    fps === 240 && chunkSize === 2000 && isLaserLockActive
                      ? 'bg-red-50 border-red-200 text-red-600 shadow-sm'
                      : 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50 text-slate-500'
                  }`}
                  title="Laser-Lock Target Selection Link"
                >
                  <span className={`text-xs font-bold block ${fps === 240 && chunkSize === 2000 && isLaserLockActive ? 'text-red-700' : 'text-slate-800'}`}>LASER-LOCK</span>
                  <span className="text-[10px] text-slate-500 block font-semibold mt-1">240 FPS</span>
                  <span className="text-[10px] text-slate-500 block">2.0K Ch</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePreset(240, 1200, false)}
                  className={`p-3 rounded-xl border-2 text-left cursor-pointer transition-all ${
                    fps === 240 && chunkSize === 1200 && !isLaserLockActive
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm'
                      : 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50 text-slate-500'
                  }`}
                  title="Supreme High-Speed"
                >
                  <span className={`text-xs font-bold block ${fps === 240 && chunkSize === 1200 && !isLaserLockActive ? 'text-indigo-800' : 'text-slate-800'}`}>SUPREME</span>
                  <span className="text-[10px] text-slate-500 block font-semibold mt-1">240 FPS</span>
                  <span className="text-[10px] text-slate-500 block">1.2K Ch</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePreset(120, 800, false)}
                  className={`p-3 rounded-xl border-2 text-left cursor-pointer transition-all ${
                    fps === 120 && chunkSize === 800 && !isLaserLockActive
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm'
                      : 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50 text-slate-500'
                  }`}
                  title="Giga Link Speed"
                >
                  <span className={`text-xs font-bold block ${fps === 120 && chunkSize === 800 && !isLaserLockActive ? 'text-indigo-800' : 'text-slate-800'}`}>GIGA</span>
                  <span className="text-[10px] text-slate-500 block font-semibold mt-1">120 FPS</span>
                  <span className="text-[10px] text-slate-500 block">800 Ch</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePreset(60, 400, false)}
                  className={`p-3 rounded-xl border-2 text-left cursor-pointer transition-all ${
                    fps === 60 && chunkSize === 400 && !isLaserLockActive
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm'
                      : 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50 text-slate-500'
                  }`}
                  title="Cyber Speed"
                >
                  <span className={`text-xs font-bold block ${fps === 60 && chunkSize === 400 && !isLaserLockActive ? 'text-indigo-800' : 'text-slate-800'}`}>CYBER</span>
                  <span className="text-[10px] text-slate-500 block font-semibold mt-1">60 FPS</span>
                  <span className="text-[10px] text-slate-500 block">400 Ch</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePreset(15, 150, false)}
                  className={`p-3 rounded-xl border-2 text-left cursor-pointer transition-all ${
                    fps === 15 && chunkSize === 150 && !isLaserLockActive
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm'
                      : 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50 text-slate-500'
                  }`}
                  title="Balanced Stable Speed"
                >
                  <span className={`text-xs font-bold block ${fps === 15 && chunkSize === 150 && !isLaserLockActive ? 'text-indigo-800' : 'text-slate-800'}`}>BALANCED</span>
                  <span className="text-[10px] text-slate-500 block font-semibold mt-1">15 FPS</span>
                  <span className="text-[10px] text-slate-500 block">150 Ch</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePreset(8, 100, false)}
                  className={`p-3 rounded-xl border-2 text-left cursor-pointer transition-all ${
                    fps === 8 && chunkSize === 100 && !isLaserLockActive
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm'
                      : 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50 text-slate-500'
                  }`}
                  title="Ultra Stable Speed"
                >
                  <span className={`text-xs font-bold block ${fps === 8 && chunkSize === 100 && !isLaserLockActive ? 'text-indigo-800' : 'text-slate-800'}`}>STABLE</span>
                  <span className="text-[10px] text-slate-500 block font-semibold mt-1">8 FPS</span>
                  <span className="text-[10px] text-slate-500 block">100 Ch</span>
                </button>
              </div>

              <div className="pt-2 border-t border-slate-200 space-y-4">
                {/* Frame Rate Adjustment */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 font-bold uppercase tracking-wider text-[11px]">Frame Speed (FPS)</span>
                    <span className="text-indigo-500 font-extrabold">{fps} Hz / FPS</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="240"
                    value={fps}
                    onChange={(e) => {
                      setFps(parseInt(e.target.value, 10));
                      handleReset();
                    }}
                    className="w-full h-1 bg-slate-50 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                  />
                  <div className="flex justify-between text-[9px] text-slate-400">
                    <span>1 FPS (SLOWER)</span>
                    <span>240 FPS (SUPREME HIGH-SPEED)</span>
                  </div>
                </div>

                {/* Chunk Characters Size */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 font-bold uppercase tracking-wider text-[11px]">Chunk Payload Size</span>
                    <span className="text-indigo-500 font-extrabold">{chunkSize} Chars</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="2500"
                    step="10"
                    value={chunkSize}
                    onChange={(e) => {
                      setIsAdaptiveEnabled(false);
                      setChunkSize(parseInt(e.target.value, 10));
                    }}
                    className="w-full h-1 bg-slate-50 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                  />
                  <div className="flex justify-between text-[9px] text-slate-400">
                    <span>50 CH (EASY SCAN)</span>
                    <span>2500 CH (LASER-LOCK DENSITY)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
