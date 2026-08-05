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
      <Header 
        onBackToHome={() => setMode('home')} 
        showBack={mode !== 'home'} 
      />

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

      <footer className="border-t border-slate-200 bg-white py-6 px-6 font-sans text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse"></span>
            <span className="font-semibold uppercase tracking-widest text-slate-700">Airgap Protocol Active</span>
          </div>
          <div>
            <span className="font-medium text-slate-400">© 2026 Optical.Shield Sandbox</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
