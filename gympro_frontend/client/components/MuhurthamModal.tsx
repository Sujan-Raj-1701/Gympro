import React from 'react';
import { Button } from '@/components/ui/button';
import { Star, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';

export interface MuhurthamGroupEntry {
  date: string;
  weekday: string;
  pirai: string;
  piraiTamil?: string;
  tamilMonth: string;
}
export interface MuhurthamMonthGroup { month: number; list: MuhurthamGroupEntry[]; }

interface MuhurthamModalProps {
  open: boolean;
  onClose: () => void;
  year: number;
  availableYears: number[];
  onPrevYear: () => void;
  onNextYear: () => void;
  grouped: MuhurthamMonthGroup[];
  listLength: number;
}

export const MuhurthamModal: React.FC<MuhurthamModalProps> = ({
  open,
  onClose,
  year,
  availableYears,
  onPrevYear,
  onNextYear,
  grouped,
  listLength,
}) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-[1180px] flex flex-col max-h-[88vh] border border-slate-200/70 dark:border-slate-700/50"
        onClick={e=> e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="px-6 py-4 border-b border-slate-200/70 dark:border-slate-700/50 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Star className="h-5 w-5 text-slate-500" />
            <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 tracking-wide">Muhurtham Dates</h3>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              disabled={availableYears.indexOf(year)===0}
              onClick={onPrevYear}
              className="h-8 w-8 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-sm font-medium px-3 py-1 rounded-md bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 tracking-wide">
              {year}
            </div>
            <Button
              variant="ghost"
              size="icon"
              disabled={availableYears.indexOf(year)===availableYears.length-1}
              onClick={onNextYear}
              className="h-8 w-8 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <button
              onClick={onClose}
              className="ml-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-sm"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="px-6 py-5 overflow-auto custom-scrollbar flex-1">
          {listLength === 0 && (
            <div className="text-sm text-slate-500">No muhurtham dates defined for {year}.</div>
          )}
          {listLength > 0 && (
            <div className="space-y-10">
              {grouped.map(g => (
                <div key={g.month} className="group/month">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 tracking-wide">
                      {format(new Date(year, g.month, 1), 'MMMM')}
                    </h4>
                    <span className="text-[11px] text-slate-400">{g.list.length}</span>
                  </div>
                  <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8">
                    {g.list.map(e => {
                      const d = new Date(e.date);
                      const dayStr = format(d,'dd MMM yyyy');
                      return (
                        <div
                          key={e.date}
                          className="relative rounded-lg border border-slate-200/70 dark:border-slate-700/60 bg-white/70 dark:bg-slate-800/40 p-3 flex flex-col gap-1 hover:shadow-sm transition group ring-1 ring-transparent hover:ring-slate-300/70 dark:hover:ring-slate-600/60"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-[13px] font-medium text-slate-800 dark:text-slate-100 leading-tight">
                              {dayStr}
                            </span>
                            <div className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600">
                              {e.pirai}
                            </div>
                          </div>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 tracking-wide uppercase">
                            {e.weekday}
                          </span>
                          <div className="flex items-center gap-1 flex-wrap text-[10px] text-slate-600 dark:text-slate-400">
                            <span className="px-2 py-0.5 rounded-md bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-medium">
                              {e.tamilMonth}
                            </span>
                            <span className="text-slate-400 dark:text-slate-600">•</span>
                            <span className="text-slate-500 dark:text-slate-400">{e.piraiTamil}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="px-6 py-3 border-t border-slate-200/70 dark:border-slate-700/50 flex items-center justify-between bg-slate-50/60 dark:bg-slate-800/40">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Showing {listLength} Muhurtham day(s) for {year}
          </div>
          <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
};
