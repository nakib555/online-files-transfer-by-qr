/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Upload, Camera, Shield, Zap, RefreshCw, Smartphone } from 'lucide-react';

interface HomeViewProps {
  onSelectMode: (mode: 'send' | 'receive') => void;
}

export default function HomeView({ onSelectMode }: HomeViewProps) {
  return (
    <div className="max-w-7xl mx-auto py-12 px-6 sm:px-12 animate-fade-in font-sans">
      {/* Hero Infographic Section */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-12 mb-20">
        <div className="md:w-1/2 space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-xs font-bold tracking-wide uppercase border border-emerald-100">
            <Shield className="w-4 h-4" />
            100% Offline Data Transfer
          </div>
          <h1 className="text-5xl md:text-6xl font-display font-bold text-slate-900 leading-tight tracking-tight">
            The Optical <br/><span className="text-indigo-600">Air-Gap</span> Protocol.
          </h1>
          <p className="text-lg text-slate-600 leading-relaxed max-w-lg">
            Securely transmit files between devices using only high-frequency visual QR code sequences. No Wi-Fi, no Bluetooth, no cables. Just pure optical physics.
          </p>
        </div>
        
        {/* Abstract Infographic Visual */}
        <div className="md:w-1/2 w-full flex justify-center">
          <div className="relative w-full max-w-md aspect-square bg-slate-50 rounded-full border-2 border-dashed border-slate-200 flex items-center justify-center">
             <div className="absolute inset-4 bg-indigo-50 rounded-full flex items-center justify-center">
                <div className="absolute inset-8 bg-indigo-100 rounded-full flex items-center justify-center animate-pulse">
                  <Smartphone className="w-16 h-16 text-indigo-600 relative z-10" />
                </div>
             </div>
             
             {/* Orbital elements representing data chunks */}
             <div className="absolute top-0 right-1/4 w-8 h-8 bg-white shadow-sm border border-slate-200 rounded-lg flex items-center justify-center rotate-12">
               <div className="w-4 h-4 bg-slate-900"></div>
             </div>
             <div className="absolute bottom-1/4 left-0 w-10 h-10 bg-white shadow-sm border border-slate-200 rounded-lg flex items-center justify-center -rotate-6">
                <div className="w-5 h-5 bg-slate-900"></div>
             </div>
             <div className="absolute bottom-8 right-12 w-6 h-6 bg-white shadow-sm border border-slate-200 rounded-lg flex items-center justify-center rotate-45">
                <div className="w-3 h-3 bg-slate-900"></div>
             </div>
          </div>
        </div>
      </div>

      {/* Action Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-20">
        <button 
          onClick={() => onSelectMode('send')}
          className="group text-left relative overflow-hidden bg-white border border-slate-200 p-8 sm:p-10 rounded-[2rem] hover:border-indigo-300 transition-all duration-300 hover:shadow-lg hover:-translate-y-1"
        >
          <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
             <Upload className="w-32 h-32 text-indigo-900" />
          </div>
          <div className="relative z-10 space-y-6">
            <div className="w-16 h-16 bg-indigo-50 flex items-center justify-center rounded-2xl text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors duration-300">
              <Upload className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-2xl font-display font-bold text-slate-900 mb-3 group-hover:text-indigo-600 transition-colors">
                Transmit File
              </h3>
              <p className="text-slate-500 leading-relaxed max-w-sm">
                Convert any local file into a stream of high-speed QR codes. Ready to be scanned by a receiving device.
              </p>
            </div>
          </div>
        </button>

        <button 
          onClick={() => onSelectMode('receive')}
          className="group text-left relative overflow-hidden bg-slate-900 border border-slate-800 p-8 sm:p-10 rounded-[2rem] hover:border-slate-700 transition-all duration-300 hover:shadow-lg hover:-translate-y-1"
        >
          <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
             <Camera className="w-32 h-32 text-white" />
          </div>
          <div className="relative z-10 space-y-6">
            <div className="w-16 h-16 bg-white/10 flex items-center justify-center rounded-2xl text-white group-hover:bg-white group-hover:text-slate-900 transition-colors duration-300">
              <Camera className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-2xl font-display font-bold text-white mb-3">
                Receive File
              </h3>
              <p className="text-slate-400 leading-relaxed max-w-sm">
                Open your camera viewport to scan an incoming stream of QR codes and reconstruct the original file instantly.
              </p>
            </div>
          </div>
        </button>
      </div>

      {/* Process Infographic */}
      <div className="py-12 border-t border-slate-200">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-display font-bold text-slate-900 mb-4">How it works</h2>
          <p className="text-slate-500 max-w-xl mx-auto">The anatomy of a zero-network optical data transfer.</p>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {[
            { step: '01', title: 'File Ingestion', desc: 'The selected file is read locally in your browser memory as a binary array.', icon: Shield },
            { step: '02', title: 'Data Sectoring', desc: 'The binary array is sliced into small optimized chunks with sequence headers.', icon: RefreshCw },
            { step: '03', title: 'Optical Pulsing', desc: 'Chunks are rapidly rendered as QR codes on the screen at up to 30 FPS.', icon: Zap },
            { step: '04', title: 'Reconstruction', desc: 'The receiver camera scans the pulses, verifying ECC data, and rebuilding the file.', icon: Camera }
          ].map((item, idx) => (
            <div key={idx} className="relative space-y-4">
              <div className="flex items-end gap-3 mb-6">
                <span className="text-6xl font-display font-bold text-slate-100 leading-none">{item.step}</span>
                <div className="w-10 h-10 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-center text-slate-600 mb-1">
                  <item.icon className="w-5 h-5" />
                </div>
              </div>
              <h4 className="text-lg font-bold text-slate-900">{item.title}</h4>
              <p className="text-sm text-slate-500 leading-relaxed">
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
