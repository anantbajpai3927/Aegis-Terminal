'use client';

import { useRef, useState } from 'react';
import { FileText, Globe, Image as ImageIcon, Link2, Paperclip, Trash2, Video } from 'lucide-react';
import type { GroundingResource } from '@/lib/types';

interface GroundingBarProps {
  resources: GroundingResource[];
  onAddResource: (res: GroundingResource) => void;
  onToggleResource: (id: string) => void;
  onRemoveResource: (id: string) => void;
  expandedView?: boolean;
}

function ResourceIcon({ kind }: { kind: GroundingResource['kind'] }) {
  if (kind === 'url') return <Globe className="w-3.5 h-3.5 text-[#9aa3b2] shrink-0" aria-hidden="true" />;
  if (kind === 'image') return <ImageIcon className="w-3.5 h-3.5 text-[#9aa3b2] shrink-0" aria-hidden="true" />;
  if (kind === 'video') return <Video className="w-3.5 h-3.5 text-[#9aa3b2] shrink-0" aria-hidden="true" />;
  return <FileText className="w-3.5 h-3.5 text-[#9aa3b2] shrink-0" aria-hidden="true" />;
}

export default function GroundingBar({
  resources,
  onAddResource,
  onToggleResource,
  onRemoveResource,
  expandedView = false,
}: GroundingBarProps) {
  const [urlInput, setUrlInput] = useState('');
  const [showUrlForm, setShowUrlForm] = useState(expandedView);
  const [ingesting, setIngesting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = urlInput.trim();
    if (!trimmed) return;

    setIngesting(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/grounding/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = (await res.json()) as { resource?: GroundingResource; error?: string };
      if (!res.ok || !data.resource) {
        setErrorMsg(data.error || 'Failed to ingest URL.');
      } else {
        onAddResource(data.resource);
        setUrlInput('');
        if (!expandedView) setShowUrlForm(false);
      }
    } catch {
      setErrorMsg('Network error while ingesting URL.');
    } finally {
      setIngesting(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setIngesting(true);
    setErrorMsg(null);
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/grounding/ingest', {
          method: 'POST',
          body: formData,
        });
        const data = (await res.json()) as { resource?: GroundingResource; error?: string };
        if (!res.ok || !data.resource) {
          setErrorMsg(data.error || `Failed to ingest ${file.name}.`);
        } else {
          onAddResource(data.resource);
        }
      }
    } catch {
      setErrorMsg('Upload error while ingesting file.');
    } finally {
      setIngesting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const enabledCount = resources.filter((r) => r.enabled).length;

  return (
    <div className={expandedView ? 'space-y-4' : 'border-b border-[#232832] px-4 py-2.5 bg-[#0f1217]'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-[#9aa3b2]">
          <span className="font-medium text-[#eef1f6]">Grounding Context</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono-tabular">
            {enabledCount} active of {resources.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.txt,.md,.csv,image/*,video/*"
            onChange={handleFileChange}
            className="hidden"
            aria-label="Upload PDF, document, text, image, or video grounding file"
          />
          <button
            type="button"
            disabled={ingesting}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-[#181c23] text-[#eef1f6] border border-[#282e39] hover:border-[#3c4556] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Paperclip className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{ingesting ? 'Loading...' : 'Add File'}</span>
          </button>

          {!expandedView && (
            <button
              type="button"
              onClick={() => setShowUrlForm((v) => !v)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-[#181c23] text-[#eef1f6] border border-[#282e39] hover:border-[#3c4556] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Link2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Add URL</span>
            </button>
          )}
        </div>
      </div>

      {(showUrlForm || expandedView) && (
        <form onSubmit={handleUrlSubmit} className="mt-2.5 flex items-center gap-2">
          <label htmlFor="grounding-url-input" className="sr-only">
            Website URL for grounding
          </label>
          <input
            id="grounding-url-input"
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://example.com/specification"
            className="flex-1 min-w-0 px-3 py-1.5 rounded-lg text-xs bg-[#0b0d10] text-[#eef1f6] placeholder:text-[#646e7e] border border-[#232832] focus:outline-none focus:border-[#4c566a]"
          />
          <button
            type="submit"
            disabled={ingesting || !urlInput.trim()}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#eef1f6] text-[#0b0d10] hover:bg-[#d8dee9] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Attach URL
          </button>
        </form>
      )}

      {errorMsg && (
        <p role="alert" className="mt-2 text-xs text-[#fca5a5]">
          {errorMsg}
        </p>
      )}

      {resources.length > 0 ? (
        <div className={expandedView ? 'space-y-2' : 'mt-2.5 flex items-center gap-2 overflow-x-auto pb-0.5'}>
          {resources.map((res) => (
            <div
              key={res.id}
              className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-xs shrink-0 ${
                res.enabled
                  ? 'bg-[#161a21] border-[#2c3340] text-[#eef1f6]'
                  : 'bg-[#0e1116] border-[#1f242d] text-[#646e7e]'
              } ${expandedView ? 'w-full' : 'max-w-[230px]'}`}
            >
              <button
                type="button"
                onClick={() => onToggleResource(res.id)}
                title={res.enabled ? 'Disable for conversation' : 'Enable for conversation'}
                className="flex items-center gap-1.5 min-w-0 text-left cursor-pointer"
              >
                <ResourceIcon kind={res.kind} />
                <span className="truncate font-medium">{res.name}</span>
                <span className="font-mono-tabular text-[11px] text-[#646e7e] shrink-0">
                  {res.kind}
                </span>
              </button>

              <button
                type="button"
                onClick={() => onRemoveResource(res.id)}
                aria-label={`Remove grounding resource ${res.name}`}
                className="p-0.5 text-[#646e7e] hover:text-[#fca5a5] transition-colors cursor-pointer shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        expandedView && (
          <div className="matte-inset rounded-xl p-6 text-center text-xs text-[#9aa3b2]">
            Attach PDFs, Word documents (.doc/.docx), text notes, images, videos, or public URLs. Attached resources remain active across the entire text and live voice conversation.
          </div>
        )
      )}
    </div>
  );
}
