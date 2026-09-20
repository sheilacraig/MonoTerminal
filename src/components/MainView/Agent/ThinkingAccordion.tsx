import React from 'react';
import { Sparkles, ChevronDown, ChevronRight } from 'lucide-react';

interface ThinkingAccordionProps {
  thinking: string;
  isExpanded: boolean;
  onToggle: () => void;
}

export const ThinkingAccordion: React.FC<ThinkingAccordionProps> = ({
  thinking,
  isExpanded,
  onToggle
}) => {
  if (!thinking) return null;

  return (
    <div className="mb-3 rounded border border-purple-900/40 bg-purple-950/20 overflow-hidden select-none">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-2.5 py-1.5 text-left text-[11px] text-purple-300 hover:bg-purple-900/20 transition-colors"
      >
        <div className="flex items-center space-x-1.5">
          <Sparkles size={12} className="text-purple-400" />
          <span className="font-medium">思考过程 (Thinking Process)</span>
        </div>
        {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>

      {isExpanded && (
        <div className="p-2.5 bg-black/30 border-t border-purple-900/30 text-[11px] text-purple-200/80 font-mono whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
          {thinking}
        </div>
      )}
    </div>
  );
};
