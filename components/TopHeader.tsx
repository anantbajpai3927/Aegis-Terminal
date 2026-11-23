'use client';

import { Mic, MicOff } from 'lucide-react';

export type WorkspaceTab = 'workspace' | 'grounding' | 'mistakes';

interface TopHeaderProps {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  voiceActive: boolean;
  voiceConnecting: boolean;
  onToggleVoice: () => void;
  resourcesCount: number;
  mistakesCount: number;
}

export default function TopHeader({
  activeTab,
  onTabChange,
  voiceActive,
  voiceConnecting,
  onToggleVoice,
  resourcesCount,
  mistakesCount,
}: TopHeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 md:px-5 py-2.5 md:py-3 border-b border-[#232832] bg-[#0e1116] shrink-0">
      <div className="flex items-center shrink-0">
        <span className="font-display text-base font-semibold tracking-tight text-[#eef1f6] whitespace-nowrap shrink-0">
          Aegis Terminal
        </span>
      </div>

      <nav
        aria-label="Primary sections"
        className="order-3 md:order-2 w-full md:w-auto flex items-center gap-5 md:gap-6 overflow-x-auto border-t border-[#1e232c] pt-2 md:border-t-0 md:pt-0"
      >
        <button
          type="button"
          onClick={() => onTabChange('workspace')}
          className={`text-xs md:text-sm font-medium whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'workspace'
              ? 'text-[#eef1f6] border-[#eef1f6]'
              : 'text-[#9aa3b2] border-transparent hover:text-[#eef1f6]'
          }`}
        >
          Workspace
        </button>

        <button
          type="button"
          onClick={() => onTabChange('grounding')}
          className={`text-xs md:text-sm font-medium whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'grounding'
              ? 'text-[#eef1f6] border-[#eef1f6]'
              : 'text-[#9aa3b2] border-transparent hover:text-[#eef1f6]'
          }`}
        >
          Grounding Vault
          <span className="ml-1.5 font-mono-tabular text-xs text-[#646e7e]">
            {resourcesCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onTabChange('mistakes')}
          className={`text-xs md:text-sm font-medium whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'mistakes'
              ? 'text-[#eef1f6] border-[#eef1f6]'
              : 'text-[#9aa3b2] border-transparent hover:text-[#eef1f6]'
          }`}
        >
          Mistake Log
          <span className="ml-1.5 font-mono-tabular text-xs text-[#646e7e]">
            {mistakesCount}
          </span>
        </button>
      </nav>

      <div className="order-2 md:order-3 flex items-center shrink-0">
        <button
          type="button"
          onClick={onToggleVoice}
          disabled={voiceConnecting}
          aria-pressed={voiceActive}
          className={`inline-flex items-center gap-2 px-3.5 md:px-4 py-1.5 md:py-2 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#eef1f6] ${
            voiceActive
              ? 'bg-[#ef4444]/15 text-[#fca5a5] border border-[#ef4444]/40 hover:bg-[#ef4444]/25'
              : 'bg-[#eef1f6] text-[#0b0d10] hover:bg-[#d8dee9] disabled:opacity-60'
          }`}
        >
          {voiceActive ? (
            <>
              <MicOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>End Voice Talk</span>
            </>
          ) : (
            <>
              <Mic className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{voiceConnecting ? 'Connecting...' : 'Start Voice Talk'}</span>
            </>
          )}
        </button>
      </div>
    </header>
  );
}
