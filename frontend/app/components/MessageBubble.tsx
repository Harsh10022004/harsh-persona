"use client";

import React from "react";

export interface Source {
  source_type: string;
  repo_name?: string;
  section?: string;
}

export interface SlotOption {
  isoTime: string;
  label: string; // e.g. "11:00 AM"
}

export interface DayGroup {
  dateKey: string;   // "2026-04-15"
  dayLabel: string;  // "Tue, Apr 15"
  range: string;     // "11:00 AM – 2:15 PM"
  slots: SlotOption[];
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  isLoading?: boolean;
  dayGroups?: DayGroup[];
  onDaySelect?: (group: DayGroup) => void;
  slotOptions?: SlotOption[];
  onSlotSelect?: (isoTime: string) => void;
}

const SOURCE_COLOURS: Record<string, string> = {
  resume:       "bg-emerald-900 text-emerald-300",
  code:         "bg-blue-900   text-blue-300",
  repo_summary: "bg-violet-900 text-violet-300",
  profile:      "bg-amber-900  text-amber-300",
  docs:         "bg-slate-700  text-slate-300",
};

function SourceBadge({ source }: { source: Source }) {
  const colour = SOURCE_COLOURS[source.source_type] ?? "bg-slate-700 text-slate-300";
  const label = source.repo_name
    ? source.repo_name
    : source.section
    ? source.section
    : source.source_type;
  return (
    <span className={`inline-block text-[10px] font-mono px-1.5 py-0.5 rounded ${colour}`}>
      {label}
    </span>
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex gap-1 items-center h-4">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse-dot"
          style={{ animationDelay: `${i * 0.16}s` }}
        />
      ))}
    </span>
  );
}

export default function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex animate-slide-up ${isUser ? "justify-end" : "justify-start"}`}
    >
      {/* Avatar */}
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-xs font-bold mr-2 mt-1">
          HV
        </div>
      )}

      <div className={`max-w-[78%] ${isUser ? "items-end" : "items-start"} flex flex-col gap-1`}>
        {/* Bubble */}
        <div
          className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
            isUser
              ? "bg-brand-600 text-white rounded-br-sm"
              : "bg-slate-800 text-slate-100 rounded-bl-sm prose-chat"
          }`}
        >
          {message.isLoading ? <ThinkingDots /> : message.content}
        </div>

        {/* Source citations */}
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="flex flex-wrap gap-1 pl-1">
            {message.sources.map((s, i) => (
              <SourceBadge key={i} source={s} />
            ))}
          </div>
        )}

        {/* Day group chips (first level) */}
        {!isUser && message.dayGroups && message.dayGroups.length > 0 && message.onDaySelect && (
          <div className="flex flex-col gap-2 pl-1 mt-1">
            {message.dayGroups.map((group) => (
              <button
                key={group.dateKey}
                onClick={() => message.onDaySelect!(group)}
                className="text-left text-sm px-4 py-2 rounded-xl bg-slate-700 hover:bg-brand-700 border border-slate-600 hover:border-brand-500 text-white transition-colors"
              >
                <span className="font-medium">{group.dayLabel}</span>
                <span className="text-slate-400 ml-2 text-xs">· {group.range}</span>
              </button>
            ))}
          </div>
        )}

        {/* Individual time slot chips (second level) */}
        {!isUser && message.slotOptions && message.slotOptions.length > 0 && message.onSlotSelect && (
          <div className="flex flex-wrap gap-2 pl-1 mt-1">
            {message.slotOptions.map((slot) => (
              <button
                key={slot.isoTime}
                onClick={() => message.onSlotSelect!(slot.isoTime)}
                className="text-xs px-3 py-1.5 rounded-full bg-brand-700 hover:bg-brand-600 border border-brand-500 text-white transition-colors"
              >
                {slot.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-semibold ml-2 mt-1">
          You
        </div>
      )}
    </div>
  );
}
