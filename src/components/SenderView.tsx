/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, DragEvent } from 'react';
import { 
  Upload, Play, Pause, SkipForward, SkipBack, RefreshCw, 
  FileText, Sliders, Settings, Check, Zap, AlertCircle
} from 'lucide-react';
import QRCode from 'qrcode';
import { FileMetadata } from '../types';
import { blobToBase64, formatChunk, formatBytes, computeCrc32, CRC32 } from '../utils/fileHelper';

export default function SenderView() {
  const [file, setFile] = useState<File | null>(null);
  const [totalChunksCount, setTotalChunksCount] = useState<number>(0);
  const [computedCrc32, setComputedCrc32] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingProgress, setProcessingProgress] = useState<number>(0);
  const [processingStatus, setProcessingStatus] = useState<string>('');

  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [fps, setFps] = useState<number>(15);
  const [chunkSize, setChunkSize] = useState<number>(150);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState<number>(0);

  // Convert character payload size to byte chunk size as a multiple of 3
  const getByteChunkSize = (charsSize: number) => {
    const bytes = Math.floor((charsSize * 3) / 4);
    return Math.max(3, Math.floor(bytes / 3) * 3);
  };

  // Re-calculate total chunks count and reset when file or chunkSize changes
  useEffect(() => {
    if (!file) return;
    const byteChunkSize = getByteChunkSize(chunkSize);
    const totalDataChunks = Math.ceil(file.size / byteChunkSize);
    setTotalChunksCount(totalDataChunks);
    handleReset();
  }, [chunkSize, file]);

  // Handle active transmission interval using high-performance requestAnimationFrame
  useEffect(() => {
    if (!isPlaying || totalChunksCount === 0 || isProcessing) return;

    if (!startTimeRef.current) {
      startTimeRef.current = performance.now() - elapsedTime;
    }

    let animFrameId: number;
    let lastFrameTime = performance.now();
    
    const tick = (now: number) => {
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

      animFrameId = requestAnimationFrame(tick);
    };

    animFrameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animFrameId);
    };
  }, [isPlaying, fps, totalChunksCount, isProcessing]);

  // Render QR Code onto canvas when index or other parameters change
  useEffect(() => {
    if (!file || totalChunksCount === 0 || !canvasRef.current || isProcessing) return;

    let isCancelled = false;

    const renderFrame = async () => {
      let rawChunk = '';
      if (currentIndex === 0) {
        // Metadata chunk
        const meta: FileMetadata = {
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream',
          chunkCount: totalChunksCount,
          crc32: computedCrc32,
        };
        rawChunk = JSON.stringify(meta);
      } else {
        // Data chunk
        const byteChunkSize = getByteChunkSize(chunkSize);
        const start = (currentIndex - 1) * byteChunkSize;
        const end = Math.min(file.size, start + byteChunkSize);
        const blobSlice = file.slice(start, end);
        rawChunk = await blobToBase64(blobSlice);
      }

      if (isCancelled) return;

      // Format: currentIndex/totalChunksCount|payload
      const textToEncode = formatChunk(currentIndex, totalChunksCount, rawChunk);

      // Dynamically select the highest possible error correction level that fits this length to avoid "too big" error
      const len = textToEncode.length;
      let ecLevel: 'L' | 'M' | 'Q' | 'H' = 'H';
      if (len > 1250) {
        if (len <= 1630) ecLevel = 'Q';
        else if (len <= 2290) ecLevel = 'M';
        else ecLevel = 'L';
      }

      QRCode.toCanvas(
        canvasRef.current,
        textToEncode,
        {
          errorCorrectionLevel: ecLevel,
          width: 1024,
          margin: 1,
          color: {
            dark: '#000000',
            light: '#ffffff',
          },
        },
        (error) => {
          if (error) {
            console.error('Error rendering QR code:', error);
          }
        }
      );
    };

    renderFrame();

    return () => {
      isCancelled = true;
    };
  }, [currentIndex, file, totalChunksCount, computedCrc32, chunkSize, isProcessing]);

  const handleFileChange = async (selectedFile: File) => {
    try {
      setFile(selectedFile);
      setIsProcessing(true);
      setProcessingProgress(0);
      setProcessingStatus('Ingesting file and initializing stream...');
      handleReset();

      const byteChunkSize = getByteChunkSize(chunkSize);
      const totalDataChunks = Math.ceil(selectedFile.size / byteChunkSize);
      setTotalChunksCount(totalDataChunks);

      // 1.5MB blocks (multiple of 3) to ensure full alignment
      const calcChunkSize = 1.5 * 1024 * 1024;
      const crcCalculator = new CRC32();
      let offset = 0;
      let blockIndex = 0;
      const totalBlocks = Math.ceil(selectedFile.size / calcChunkSize);

      while (offset < selectedFile.size) {
        const sliceEnd = Math.min(selectedFile.size, offset + calcChunkSize);
        const slice = selectedFile.slice(offset, sliceEnd);
        const b64Part = await blobToBase64(slice);
        crcCalculator.update(b64Part);
        
        offset = sliceEnd;
        blockIndex++;
        
        setProcessingProgress(Math.round((blockIndex / totalBlocks) * 100));
        setProcessingStatus(`Hashing file payload integrity: ${formatBytes(offset)} / ${formatBytes(selectedFile.size)}`);
        
        if (blockIndex % 5 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      const finalCrc = crcCalculator.getValue();
      setComputedCrc32(finalCrc);
      setIsProcessing(false);
    } catch (err) {
      console.error('File reading failed:', err);
      setIsProcessing(false);
      alert('Failed to read file. Please try another one.');
    }
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
      handleFileChange(e.dataTransfer.files[0]);
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

  const handlePreset = (selectedFps: number, selectedSize: number) => {
    setFps(selectedFps);
    setChunkSize(selectedSize);
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
    <div className="max-w-4xl mx-auto py-6 px-4 animate-fade-in font-mono">
      {isProcessing ? (
        <div className="max-w-md mx-auto border border-slate-200 bg-white p-3 sm:p-4 sm:p-8 rounded-2xl flex flex-col items-center justify-center space-y-6 text-center shadow-xl">
          <RefreshCw className="w-12 h-12 text-indigo-500 animate-spin" />
          <div className="space-y-2 w-full">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest">{processingStatus}</h3>
            <div className="w-full bg-slate-50 h-2.5 rounded-full overflow-hidden border border-slate-200">
              <div
                className="bg-indigo-600 h-full transition-all duration-300 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                style={{ width: `${processingProgress}%` }}
              ></div>
            </div>
            <span className="text-xs text-slate-500 font-bold block">{processingProgress}% Complete</span>
          </div>
        </div>
      ) : !file ? (
        <div className="space-y-6">
          <div className="text-center max-w-lg mx-auto mb-8">
            <h2 className="text-xl font-bold text-slate-900 tracking-wider mb-2">OPTICAL TRANSMITTER MODULE</h2>
            <p className="text-xs text-slate-500">
              Prepare a file for offline, air-gapped optical transfer. Upload the file to slice it into QR code sequences ready for physical scanning.
            </p>
          </div>

          {/* Drag & Drop File Upload Zone */}
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center transition-all ${
              isDragging 
                ? 'border-indigo-600 bg-indigo-600/5 text-indigo-500' 
                : 'border-slate-200 bg-white hover:border-slate-300 text-slate-500'
            }`}
          >
            <Upload className={`w-12 h-12 mb-4 transition-transform ${isDragging ? 'scale-110 text-indigo-500' : 'text-slate-500'}`} />
            <h3 className="text-sm font-semibold text-slate-800 mb-1">DRAG & DROP FILE HERE</h3>
            <p className="text-xs text-slate-500 mb-4">Support any format up to 1 GB+ with progressive memory slicing</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">— OR —</span>
            </div>
            <label className="mt-4 border border-slate-300 hover:border-indigo-600/50 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs px-4 py-2 rounded font-semibold tracking-wider cursor-pointer transition-all">
              SELECT_FILE
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleFileChange(e.target.files[0]);
                  }
                }}
              />
            </label>
          </div>

          {/* Quick Security Tip Box */}
          <div className="border border-slate-200/80 bg-white/40 p-3 sm:p-4 rounded-xl flex gap-3">
            <AlertCircle className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide">Optical Transfer Physics</h4>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                Optical airgaps rely on perfect visual synchronization. We convert file bytes to low-density high-contrast black-and-white pixels. High frame rates (up to 240 FPS) require a high refresh-rate screen and camera synchronization.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-start">
          {/* Left Column: QR Code Display Container */}
          <div className="lg:col-span-6 flex flex-col items-center gap-3 sm:p-4">
            <div className="w-full border border-slate-200 bg-white p-3 sm:p-4 sm:p-6 rounded-2xl flex flex-col items-center justify-center relative overflow-hidden">
              {/* Corner Indicators */}
              <div className="absolute top-3 left-3 w-4 h-4 border-t-2 border-l-2 border-indigo-600/40"></div>
              <div className="absolute top-3 right-3 w-4 h-4 border-t-2 border-r-2 border-indigo-600/40"></div>
              <div className="absolute bottom-3 left-3 w-4 h-4 border-b-2 border-l-2 border-indigo-600/40"></div>
              <div className="absolute bottom-3 right-3 w-4 h-4 border-b-2 border-r-2 border-indigo-600/40"></div>

              {/* QR Canvas */}
              <div className="bg-white p-2 sm:p-3 w-full max-w-full sm:max-w-[400px] md:max-w-[500px] rounded-lg shadow-2xl relative flex justify-center items-center">
                {totalChunksCount === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/80">
                    <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
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
            <div className="w-full border border-slate-200 bg-white p-4 sm:p-5 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-indigo-500" />
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide">Live Diagnostics</h4>
                </div>
                <div className="px-2 py-1 bg-slate-50 rounded border border-slate-200 flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-500 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-600"></span>
                  </span>
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest text-indigo-500">
                    {((fps * getByteChunkSize(chunkSize)) / 1024 / 1024).toFixed(3)} MB/s
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 block text-[10px] tracking-wider uppercase">Elapsed Session</span>
                  <span className="font-bold text-slate-700">{formatTimer(elapsedTime)}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] tracking-wider uppercase">Est. Completion</span>
                  <span className="font-bold text-slate-700">
                    {totalChunksCount > 0 ? formatTimer(((totalChunksCount + 1) * 1000) / fps) : '00:00.0'}
                  </span>
                </div>
              </div>

              <div className="text-[10px] text-slate-500 bg-slate-50/50 p-3 rounded border border-slate-200/80 leading-relaxed font-mono">
                <span className="text-indigo-500 font-semibold block uppercase mb-1">Optical Frame Blueprint</span>
                {totalChunksCount > 0 ? (
                  <span className="break-all font-mono opacity-80 block truncate">
                    Streaming dynamically sliced binary payload at frame {currentIndex}...
                  </span>
                ) : (
                  <span>Awaiting file parsing telemetry...</span>
                )}
              </div>
            </div>

            {/* Playback Controls Panel */}
            <div className="w-full border border-slate-200 bg-white p-3 sm:p-4 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={stepPrev}
                  className="p-2.5 rounded bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 hover:text-indigo-500 transition-all cursor-pointer"
                  title="Previous Frame"
                >
                  <SkipBack className="w-4 h-4" />
                </button>
                <button
                  onClick={togglePlayback}
                  className={`px-6 py-2.5 rounded flex items-center gap-2 font-bold tracking-wider cursor-pointer text-xs transition-all ${
                    isPlaying
                      ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/40'
                      : 'bg-indigo-600 text-white hover:bg-indigo-500 border border-indigo-600 font-extrabold'
                  }`}
                >
                  {isPlaying ? (
                    <>
                      <Pause className="w-4 h-4 fill-amber-400" /> PAUSE
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-white" /> START
                    </>
                  )}
                </button>
                <button
                  onClick={stepNext}
                  className="p-2.5 rounded bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 hover:text-indigo-500 transition-all cursor-pointer"
                  title="Next Frame"
                >
                  <SkipForward className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleReset}
                  className="p-2.5 rounded bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-500 hover:text-red-400 transition-all cursor-pointer"
                  title="Reset Sequence"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    setFile(null);
                    setTotalChunksCount(0);
                    setComputedCrc32('');
                  }}
                  className="text-[11px] font-bold border border-slate-200 hover:border-red-500/30 bg-slate-50 text-slate-500 hover:text-red-400 px-3 py-2.5 rounded transition-colors cursor-pointer"
                >
                  EJECT
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: File Details & Transmission Tuning Panel */}
          <div className="lg:col-span-6 space-y-4">
            {/* File Info Card */}
            <div className="border border-slate-200 bg-white p-4 sm:p-5 rounded-xl space-y-4">
              <div className="flex items-start gap-3">
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded text-indigo-500">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="overflow-hidden flex-1">
                  <h3 className="text-sm font-bold text-slate-900 truncate">{file.name}</h3>
                  <p className="text-xs text-slate-500 font-mono mt-0.5 uppercase tracking-wider">{file.type || 'UNKNOWN/RAW'}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                <div className="bg-slate-50/50 border border-slate-200 px-3 py-2 rounded">
                  <span className="text-[10px] text-slate-500 block uppercase tracking-wider">FILE SIZE</span>
                  <span className="text-xs font-bold text-slate-800">{formatBytes(file.size)}</span>
                </div>
                <div className="bg-slate-50/50 border border-slate-200 px-3 py-2 rounded">
                  <span className="text-[10px] text-slate-500 block uppercase tracking-wider">CHUNKS TOTAL</span>
                  <span className="text-xs font-bold text-slate-800">{totalChunksCount + 1}</span>
                </div>
              </div>

              {/* Progress Indicator Track */}
              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between text-[11px] font-bold">
                  <span className="text-slate-500">TRANSMISSION PROGRESS</span>
                  <span className="text-indigo-500">
                    {totalChunksCount > 0 ? Math.round((currentIndex / totalChunksCount) * 100) : 0}%
                  </span>
                </div>
                <div className="w-full bg-slate-50 h-2.5 rounded-full overflow-hidden border border-slate-200">
                  <div
                    className="h-full transition-all duration-300 bg-indigo-600"
                    style={{ width: `${totalChunksCount > 0 ? Math.round((currentIndex / totalChunksCount) * 100) : 0}%` }}
                  ></div>
                </div>
              </div>
            </div>

            {/* Transmission Presets Configuration */}
            <div className="border border-slate-200 bg-white p-4 sm:p-5 rounded-xl space-y-4">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-500" />
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide">Optical Presets</h4>
              </div>

              <div className="grid grid-cols-5 gap-1.5">
                <button
                  type="button"
                  onClick={() => handlePreset(240, 4096)}
                  className={`p-2 rounded border text-left cursor-pointer transition-all ${
                    fps === 240 && chunkSize === 4096
                      ? 'bg-indigo-600/10 border-indigo-600 text-indigo-500'
                      : 'bg-slate-50/40 border-slate-200 hover:border-slate-300 text-slate-500'
                  }`}
                  title="Supreme High-Speed"
                >
                  <span className="text-[9px] font-extrabold block">SUPREME</span>
                  <span className="text-[8px] text-slate-500 block">240 FPS</span>
                  <span className="text-[8px] text-slate-500 block">4K Ch</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePreset(120, 2600)}
                  className={`p-2 rounded border text-left cursor-pointer transition-all ${
                    fps === 120 && chunkSize === 2600
                      ? 'bg-indigo-600/10 border-indigo-600 text-indigo-500'
                      : 'bg-slate-50/40 border-slate-200 hover:border-slate-300 text-slate-500'
                  }`}
                  title="Giga Link Speed"
                >
                  <span className="text-[9px] font-extrabold block">GIGA</span>
                  <span className="text-[8px] text-slate-500 block">120 FPS</span>
                  <span className="text-[8px] text-slate-500 block">2.6K Ch</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePreset(60, 500)}
                  className={`p-2 rounded border text-left cursor-pointer transition-all ${
                    fps === 60 && chunkSize === 500
                      ? 'bg-indigo-600/10 border-indigo-600 text-indigo-500'
                      : 'bg-slate-50/40 border-slate-200 hover:border-slate-300 text-slate-500'
                  }`}
                  title="Cyber Speed"
                >
                  <span className="text-[9px] font-extrabold block">CYBER</span>
                  <span className="text-[8px] text-slate-500 block">60 FPS</span>
                  <span className="text-[8px] text-slate-500 block">500 Ch</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePreset(15, 150)}
                  className={`p-2 rounded border text-left cursor-pointer transition-all ${
                    fps === 15 && chunkSize === 150
                      ? 'bg-indigo-600/10 border-indigo-600 text-indigo-500'
                      : 'bg-slate-50/40 border-slate-200 hover:border-slate-300 text-slate-500'
                  }`}
                  title="Balanced Stable Speed"
                >
                  <span className="text-[9px] font-extrabold block">BALANCED</span>
                  <span className="text-[8px] text-slate-500 block">15 FPS</span>
                  <span className="text-[8px] text-slate-500 block">150 Ch</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePreset(8, 100)}
                  className={`p-2 rounded border text-left cursor-pointer transition-all ${
                    fps === 8 && chunkSize === 100
                      ? 'bg-indigo-600/10 border-indigo-600 text-indigo-500'
                      : 'bg-slate-50/40 border-slate-200 hover:border-slate-300 text-slate-500'
                  }`}
                  title="Ultra Stable Speed"
                >
                  <span className="text-[9px] font-extrabold block">STABLE</span>
                  <span className="text-[8px] text-slate-500 block">8 FPS</span>
                  <span className="text-[8px] text-slate-500 block">100 Ch</span>
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
                    max="4096"
                    step="10"
                    value={chunkSize}
                    onChange={(e) => {
                      setChunkSize(parseInt(e.target.value, 10));
                    }}
                    className="w-full h-1 bg-slate-50 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                  />
                  <div className="flex justify-between text-[9px] text-slate-400">
                    <span>50 CH (EASY SCAN)</span>
                    <span>4096 CH (COMPACT GIGA-LINK)</span>
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
