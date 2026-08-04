/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Upload, Camera, Shield, Zap, AlertCircle } from 'lucide-react';

interface HomeViewProps {
  onSelectMode: (mode: 'send' | 'receive') => void;
}

export default function HomeView({ onSelectMode }: HomeViewProps) {
  return (
    <div className="max-w-4xl mx-auto py-12 px-6 animate-fade-in font-mono">
      {/* Title block */}
      <div className="text-center max-w-2xl mx-auto mb-12 space-y-3">
        <h2 className="text-2xl font-bold text-slate-900 tracking-wider">SECURE OPTICAL AIR-GAP</h2>
        <p className="text-xs text-slate-500 leading-relaxed uppercase tracking-wider font-semibold">
          ZERO NETWORKS / ZERO BLUETOOTH / ZERO CABLES
        </p>
        <div className="h-[1px] w-24 bg-indigo-200 mx-auto my-3"></div>
        <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
          Transfer sensitive credentials, keyfiles, or archives securely across an absolute physical airgap using high-frequency light pulses.
        </p>
      </div>

      {/* Select Mode Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
        {/* Send File Card */}
        <div 
          onClick={() => onSelectMode('send')}
          className="group border border-slate-200 bg-white hover:border-indigo-400 p-8 rounded-2xl flex flex-col justify-between transition-all duration-300 cursor-pointer shadow-sm hover:shadow-md"
        >
          <div className="space-y-4">
            <div className="w-12 h-12 border border-slate-100 bg-slate-50 flex items-center justify-center rounded-lg text-indigo-600 group-hover:bg-indigo-50 group-hover:border-indigo-200 transition-colors">
              <Upload className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-base font-bold text-slate-900 uppercase tracking-wide group-hover:text-indigo-700 transition-colors">
                SEND_FILE (TRANSMIT)
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Slice local binary documents or archives into optimized high-speed optical packet sequences encoded in high-contrast QR codes.
              </p>
            </div>
          </div>
          <div className="mt-8 flex items-center text-xs font-bold text-slate-400 group-hover:text-indigo-600 transition-colors pt-4 border-t border-slate-100">
            LOAD TRANSMITTER LINK &rarr;
          </div>
        </div>

        {/* Receive File Card */}
        <div 
          onClick={() => onSelectMode('receive')}
          className="group border border-slate-200 bg-white hover:border-indigo-400 p-8 rounded-2xl flex flex-col justify-between transition-all duration-300 cursor-pointer shadow-sm hover:shadow-md"
        >
          <div className="space-y-4">
            <div className="w-12 h-12 border border-slate-100 bg-slate-50 flex items-center justify-center rounded-lg text-indigo-600 group-hover:bg-indigo-50 group-hover:border-indigo-200 transition-colors">
              <Camera className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-base font-bold text-slate-900 uppercase tracking-wide group-hover:text-indigo-700 transition-colors">
                RECEIVE_FILE (SCANNER)
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Activate the viewport capture sandbox. Scan incoming light pulses, verify integrity blocks, and re-compile back to source binary files.
              </p>
            </div>
          </div>
          <div className="mt-8 flex items-center text-xs font-bold text-slate-400 group-hover:text-indigo-600 transition-colors pt-4 border-t border-slate-100">
            SPAWN SCANNER SANDBOX &rarr;
          </div>
        </div>
      </div>

      {/* Physics explanation & Chain mapping */}
      <div className="border border-slate-200 bg-white p-6 rounded-2xl space-y-4 shadow-sm">
        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-widest flex items-center gap-2">
          <Shield className="w-4 h-4 text-indigo-500" />
          Optical Air-Gap Sequence Flow
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-2 font-mono text-xs text-slate-500">
          <div className="space-y-1">
            <span className="text-indigo-600 font-extrabold block">01. INGESTION</span>
            <p className="text-[11px] leading-relaxed">Convert local files safely into binary array strings inside the local environment.</p>
          </div>
          <div className="space-y-1">
            <span className="text-indigo-600 font-extrabold block">02. SECTORING</span>
            <p className="text-[11px] leading-relaxed">Slice into 150-char blocks with strict header sequence metadata identifiers.</p>
          </div>
          <div className="space-y-1">
            <span className="text-indigo-600 font-extrabold block">03. PULSING</span>
            <p className="text-[11px] leading-relaxed">Sequentially loop frames onto a crisp white-on-black display grid at up to 30Hz.</p>
          </div>
          <div className="space-y-1">
            <span className="text-indigo-600 font-extrabold block">04. DOWNLOAD</span>
            <p className="text-[11px] leading-relaxed">The receiving webcam captures light frames, decodes blocks, and auto-downloads the file.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
