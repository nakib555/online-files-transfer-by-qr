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
    <header className="border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-50 px-4 sm:px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 sm:gap-4">
        <div className="flex items-center gap-4 shrink-0">
          <div className="relative">
            <div className="absolute inset-0 bg-indigo-500/10 rounded-xl filter blur-sm"></div>
            <div className="relative border border-indigo-200 p-2.5 bg-slate-50 rounded-xl">
              <Cpu className="w-6 h-6 text-indigo-600" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 
                onClick={onBackToHome}
                className="text-xl font-display font-bold text-slate-900 tracking-tight cursor-pointer hover:text-indigo-600 transition-colors"
              >
                OpticalShield
              </h1>
              <span className="text-[10px] font-bold bg-indigo-50 text-indigo-600 border border-indigo-100 px-2 py-0.5 rounded-full uppercase tracking-wide">
                v1.2
              </span>
            </div>
            <p className="text-sm text-slate-500 font-sans mt-0.5">Air-Gapped Data Protocol</p>
          </div>
        </div>

        <div className="flex items-center gap-4 font-sans text-sm">
          {showBack && onBackToHome && (
            <button
              onClick={onBackToHome}
              className="text-slate-600 font-semibold hover:text-indigo-600 border border-slate-200 hover:border-indigo-200 px-4 py-2 bg-white hover:bg-slate-50 transition-all cursor-pointer rounded-full shadow-sm flex items-center gap-2"
            >
              &larr; Back to Menu
            </button>
          )}
          <div className="hidden sm:flex items-center gap-2 border border-emerald-100 bg-emerald-50 px-4 py-2 rounded-full text-emerald-700">
            <WifiOff className="w-4 h-4" />
            <span className="font-bold tracking-wide text-xs uppercase">100% Offline</span>
          </div>
        </div>
      </div>
    </header>
  );
}
