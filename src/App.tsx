/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import Header from './components/Header';
import HomeView from './components/HomeView';
import SenderView from './components/SenderView';
import ReceiverView from './components/ReceiverView';
import { AppMode } from './types';

export default function App() {
  const [mode, setMode] = useState<AppMode>('home');

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col antialiased selection:bg-indigo-500/30 selection:text-indigo-900">
      {/* Top sticky nav bar with status indicators */}
      <Header 
        onBackToHome={() => setMode('home')} 
        showBack={mode !== 'home'} 
      />

      {/* Main interactive portal */}
      <main className="flex-grow flex flex-col justify-start">
        {mode === 'home' && (
          <HomeView onSelectMode={(selectedMode) => setMode(selectedMode)} />
        )}

        {mode === 'send' && (
          <div className="w-full">
            <SenderView />
          </div>
        )}

        {mode === 'receive' && (
          <div className="w-full">
            <ReceiverView />
          </div>
        )}
      </main>

      {/* Industrial status bar footer */}
      <footer className="border-t border-slate-200 bg-white/40 py-4 px-4 sm:px-6 font-mono text-[10px] text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping"></span>
            <span className="tracking-widest font-semibold">AIRGAP ACTIVE / ENCRYPTED BUFFER / NO EXTERNAL TELEMETRY</span>
          </div>
          <div>
            <span className="font-semibold">SYSTEM READY // PORT 3000 SANDBOXED // 2026 UTC</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
