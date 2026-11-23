'use client';

import { ShieldAlert } from 'lucide-react';
import type { MistakeLogEntry } from '@/lib/types';

interface MistakeLogPanelProps {
  mistakes: MistakeLogEntry[];
}

export default function MistakeLogPanel({ mistakes }: MistakeLogPanelProps) {
  return (
    <section
      aria-label="Unforgivable Mistake Context Log"
      className="matte-panel rounded-2xl p-6 space-y-4 h-full overflow-y-auto"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#232832]">
        <div className="space-y-1">
          <h2 className="font-display text-lg font-semibold text-[#eef1f6]">
            Mistake Context Log
          </h2>
          <p className="text-xs text-[#9aa3b2]">
            Every anomaly flagged by Agent 2 or Agent 3 is recorded here and injected into Agent 1 and Agent 2 context so mistakes are never repeated.
          </p>
        </div>
        <div className="font-mono-tabular text-xs text-[#9aa3b2]">
          {mistakes.length} logged event{mistakes.length === 1 ? '' : 's'}
        </div>
      </div>

      {mistakes.length === 0 ? (
        <div className="matte-inset rounded-xl p-8 text-center text-sm text-[#9aa3b2]">
          No anomalies have been flagged yet. Whenever Agent 2 or Agent 3 flags a hallucination, source mismatch, or reasoning incompatibility, the entry and selective retry path will appear here.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#232832] text-[#9aa3b2]">
                <th className="py-2.5 pr-4 font-medium">Step</th>
                <th className="py-2.5 pr-4 font-medium">Attempt</th>
                <th className="py-2.5 pr-4 font-medium">Flagged By</th>
                <th className="py-2.5 pr-4 font-medium">Fault Owner</th>
                <th className="py-2.5 pr-4 font-medium">Reason</th>
                <th className="py-2.5 font-medium">Resolution Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e232c]">
              {mistakes.map((entry) => (
                <tr key={entry.id} className="hover:bg-[#161a21]/60 align-top">
                  <td className="py-3 pr-4 font-medium text-[#eef1f6] whitespace-nowrap">
                    {entry.stepLabel}
                  </td>
                  <td className="py-3 pr-4 font-mono-tabular text-[#fbbf24] whitespace-nowrap">
                    {entry.attempt}/4
                  </td>
                  <td className="py-3 pr-4 font-mono-tabular text-[#cbd5e1] whitespace-nowrap">
                    {entry.flaggedBy.toUpperCase()}
                  </td>
                  <td className="py-3 pr-4 font-mono-tabular text-[#fca5a5] whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <ShieldAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>{entry.faultOwner.toUpperCase()}</span>
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-[#e3e7ee] min-w-[240px]">
                    {entry.reason}
                  </td>
                  <td className="py-3 text-[#9aa3b2] min-w-[220px]">
                    {entry.resolutionNote}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
