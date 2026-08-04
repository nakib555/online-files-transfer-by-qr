/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Shield, WifiOff, Cpu } from 'lucide-react';

interface HeaderProps {
  onBackToHome?: () => void;
  showBack?: boolean;
}

export default function Header({ onBackToHome, showBack = false }: HeaderProps) {
  return (
    <header className="border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-50 px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 bg-indigo-500/10 rounded filter blur-sm"></div>
            <div className="relative border border-indigo-200 p-2 bg-slate-50 rounded">
              <Cpu className="w-5 h-5 text-indigo-600" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 
                onClick={onBackToHome}
                className="text-lg font-mono font-bold text-slate-900 tracking-wider cursor-pointer hover:text-indigo-600 transition-colors"
              >
                OPTICAL.SHIELD
              </h1>
              <span className="text-[10px] font-mono font-bold bg-indigo-50 text-indigo-600 border border-indigo-200 px-1.5 py-0.5 rounded uppercase tracking-widest">
                v1.2
              </span>
            </div>
            <p className="text-xs text-slate-500 font-mono">Air-Gapped Optical Data Link</p>
          </div>
        </div>

        <div className="flex items-center gap-4 font-mono text-xs">
          {showBack && onBackToHome && (
            <button
              onClick={onBackToHome}
              className="text-slate-600 hover:text-indigo-600 border border-slate-200 hover:border-indigo-300 px-3 py-1.5 bg-slate-50 hover:bg-white transition-all cursor-pointer rounded font-medium shadow-sm"
            >
              &larr; MAIN_MENU
            </button>
          )}
          <div className="flex items-center gap-2 border border-indigo-200 bg-indigo-50 px-3 py-1.5 rounded text-indigo-700">
            <WifiOff className="w-3.5 h-3.5" />
            <span className="font-bold tracking-wider text-[11px]">100% OFFLINE</span>
          </div>
          <div className="hidden sm:flex items-center gap-2 border border-slate-200 bg-slate-50 px-3 py-1.5 rounded text-slate-600">
            <Shield className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[11px] font-medium">SECURE SANDBOX</span>
          </div>
        </div>
      </div>
    </header>
  );
}
