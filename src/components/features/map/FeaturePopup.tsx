import { useState, useEffect } from 'react';
import { Search, Zap, Info } from 'lucide-react';
import { Button } from '@/components/common/button';
import {
  fetchBmuGeneration,
  fetchBmuBoal,
  type BmuGenerationData,
  type BmuBoalData,
} from '@/lib/api/elexon';
import { cn } from '@/lib/utils';

export interface PopupInfo {
  title: string;
  subtitle?: string;
  rows: Array<{ label: string; value: string }>;
  imageUrl?: string;
  bmuId?: string;
  bmuIds?: string[];
  properties?: Record<string, unknown>;
  coordinates?: [number, number];
  zoom?: number;
}

interface FeaturePopupProps {
  info: PopupInfo;
  onExpand: () => void;
}

export const FeaturePopup = ({ info, onExpand }: FeaturePopupProps) => {
  const [generationData, setGenerationData] = useState<BmuGenerationData[] | null>(null);
  const [boalData, setBoalData] = useState<BmuBoalData[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const bmuIds = info.bmuIds || (info.bmuId ? [info.bmuId] : []);
  const isGenerationAsset = bmuIds.length > 0;

  useEffect(() => {
    if (isGenerationAsset) {
      setIsLoading(true);
      const now = new Date();
      const from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(); // Last 24 hours
      const to = now.toISOString();

      Promise.all([fetchBmuGeneration(bmuIds, from, to), fetchBmuBoal(bmuIds, from, to)])
        .then(([genData, boalData]) => {
          setGenerationData(genData);
          setBoalData(boalData);
        })
        .catch((err) => console.error('Failed to fetch generation data', err))
        .finally(() => setIsLoading(false));
    } else {
      setGenerationData(null);
      setBoalData(null);
    }
  }, [info.bmuId, info.bmuIds]);

  const getLatestAggregatedOutput = () => {
    if (!generationData || generationData.length === 0) return null;

    const now = new Date();
    const nowTime = now.getTime();

    // Identify all unique BMUs (from generationData or info.bmuIds)
    // Ensure we check all BMUs requested in info, or found in data.
    const allRelevantBmuIds = new Set(bmuIds);
    generationData.forEach((d) => allRelevantBmuIds.add(d.bmuId));
    const uniqueBmuIds = Array.from(allRelevantBmuIds);

    let totalQuantity = 0;
    let isCurtailed = false;
    let anyDataFound = false;

    uniqueBmuIds.forEach((bmuId) => {
      // 1. PN (Baseline) - Find latest PN starting before 'now'
      const bmuPns = generationData.filter((d) => d.bmuId === bmuId);
      const activePn = bmuPns
        .filter((d) => new Date(d.timeFrom).getTime() <= nowTime)
        .sort((a, b) => new Date(b.timeFrom).getTime() - new Date(a.timeFrom).getTime())[0];
      const pnLevel = activePn ? activePn.quantity : 0;
      if (activePn) anyDataFound = true;

      // 2. BOAL (Override) - Find active BOAL instruction specifically at 'now'
      const bmuBoals = boalData?.filter((d) => d.bmuId === bmuId) || [];
      const activeBoalInst = bmuBoals.find((d) => {
        const start = new Date(d.timeFrom).getTime();
        const end = new Date(d.timeTo).getTime();
        return nowTime >= start && nowTime < end;
      });

      if (activeBoalInst) {
        // If under BOAL instruction, usage levelFrom (as per graph stepAfter logic)
        totalQuantity += activeBoalInst.levelFrom;
        isCurtailed = true; // Mark as curtailed if any unit is under active instruction
        anyDataFound = true;
      } else {
        // Otherwise use PN
        totalQuantity += pnLevel;
      }
    });

    if (!anyDataFound && uniqueBmuIds.length > 0) return null;

    return {
      settlementDate: now.toISOString().split('T')[0],
      settlementPeriod: 0,
      timeFrom: now.toISOString(),
      quantity: totalQuantity,
      isCurtailed: isCurtailed,
      bmuId: 'AGGREGATED',
    };
  };

  const getCapacity = () => {
    const capacityRow = info.rows.find((r) => r.label === 'Capacity' || r.label === 'Output');
    if (!capacityRow) return null;
    const match = capacityRow.value.match(/([\d,.]+)/);
    return match ? parseFloat(match[1].replace(/,/g, '')) : null;
  };

  const latestOutput = getLatestAggregatedOutput();
  const capacity = getCapacity();
  const percentage = latestOutput && capacity ? (latestOutput.quantity / capacity) * 100 : null;

  return (
    <div className="flex flex-col w-72 bg-card">
      {/* Image Section */}
      {/* Image Section or Header */}
      {info.imageUrl ? (
        <div className="relative h-40 w-full bg-muted">
          <img src={info.imageUrl} alt={info.title} className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

          {/* Title Overlay */}
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <h3 className="text-base font-bold leading-tight text-white drop-shadow-md">
              {info.title}
            </h3>
            {info.subtitle && (
              <p className="text-xs font-medium text-slate-200 drop-shadow-md mt-0.5">
                {info.subtitle}
              </p>
            )}
          </div>

          {/* Status Badge (Overlay) */}
          <div className="absolute top-3 right-3 flex items-center gap-2">
            {isGenerationAsset && (
              <div className="flex items-center gap-1.5 rounded-full bg-slate-900/80 px-2 py-0.5 backdrop-blur-md border border-white/10 shadow-sm">
                <div className={cn("h-1.5 w-1.5 rounded-full animate-pulse", (latestOutput?.quantity || 0) > 0 ? "bg-emerald-400" : "bg-red-400")} />
                <span className="text-[10px] font-bold tracking-wide text-white uppercase">
                  {(latestOutput?.quantity || 0) > 0 ? "Active" : "Offline"}
                </span>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* No Image Header */
        <div className="p-4 pb-0 flex flex-col relative">
          <h3 className="text-base font-bold leading-tight text-slate-900">
            {info.title}
          </h3>
          {info.subtitle && (
            <p className="text-xs font-medium text-slate-500 mt-0.5">
              {info.subtitle}
            </p>
          )}

          {/* Status Badge (Inline/Absolute) */}
          <div className="absolute top-4 right-4">
            {isGenerationAsset && (
              <div className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 border border-slate-200">
                <div className={cn("h-1.5 w-1.5 rounded-full", (latestOutput?.quantity || 0) > 0 ? "bg-emerald-500" : "bg-red-500")} />
                <span className="text-[10px] font-bold tracking-wide text-slate-700 uppercase">
                  {(latestOutput?.quantity || 0) > 0 ? "Active" : "Offline"}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Content Section */}
      <div className="p-4 space-y-4">
        {/* Live Data or Key Attributes */}
        <div>
          {isGenerationAsset ? (
            <div className="rounded-lg bg-slate-50 p-4 border border-slate-100 shadow-sm relative overflow-hidden">
              {/* Background Gloss */}
              <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-gradient-to-br from-white/80 to-transparent blur-2xl pointer-events-none" />

              <div className="flex items-start justify-between relative z-10">
                {/* Text Column */}
                <div className="flex flex-col gap-4">
                  {/* Live Output Block */}
                  <div>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span
                        className={cn(
                          'text-[10px] font-bold uppercase tracking-wider',
                          latestOutput?.isCurtailed ? 'text-amber-600' : 'text-slate-500',
                        )}
                      >
                        {latestOutput?.isCurtailed ? 'Live Output (Curtailed)' : 'Live Output'}
                      </span>
                      <Zap
                        className={cn(
                          'h-3 w-3',
                          latestOutput?.isCurtailed ? 'text-amber-600' : 'text-amber-400',
                        )}
                      />
                    </div>

                    <div className="flex items-baseline gap-1">
                      {isLoading ? (
                        <div className="h-8 w-24 animate-pulse rounded bg-slate-200" />
                      ) : latestOutput ? (
                        <>
                          <span className="text-xl font-black text-slate-900 tracking-tight leading-none">
                            {Math.round(latestOutput.quantity)}
                          </span>
                          <span className="text-xs font-bold text-slate-400">MW</span>
                        </>
                      ) : (
                        <span className="text-sm text-slate-400 italic">Data unavailable</span>
                      )}
                    </div>
                  </div>

                  {/* Installed Capacity Block */}
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
                      Installed Capacity
                    </div>
                    <div className="flex items-baseline gap-1">
                      {capacity ? (
                        <>
                          <span className="text-xl font-black text-slate-900 tracking-tight leading-none">
                            {Math.round(capacity)}
                          </span>
                          <span className="text-xs font-bold text-slate-400">MW</span>
                        </>
                      ) : (
                        <span className="text-sm text-slate-400 italic">--</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Gauge Column */}
                <div className="flex items-center justify-center pt-2">
                  {/* Gauge (Only show if we have percentage) */}
                  {percentage !== null && !isLoading && (
                    <div className="relative flex items-center justify-center h-20 w-20">
                      <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 100 100">
                        {/* Background Circle */}
                        <circle
                          className="text-slate-100"
                          strokeWidth="8"
                          stroke="currentColor"
                          fill="transparent"
                          r="42"
                          cx="50"
                          cy="50"
                        />
                        {/* Progress Circle */}
                        <circle
                          className={cn(
                            'transition-all duration-1000 ease-out',
                            percentage > 90 ? 'text-green-500' : percentage > 50 ? 'text-blue-500' : 'text-blue-500' // Matches screenshot blueish tone
                          )}
                          style={{
                            filter: 'drop-shadow(0 2px 4px rgba(59, 130, 246, 0.3))'
                          }}
                          strokeWidth="8"
                          strokeDasharray={2 * Math.PI * 42}
                          strokeDashoffset={2 * Math.PI * 42 * (1 - percentage / 100)}
                          strokeLinecap="round"
                          stroke="currentColor"
                          fill="transparent"
                          r="42"
                          cx="50"
                          cy="50"
                        />
                      </svg>

                      {/* Centered Percentage Text */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className={cn(
                          "text-lg font-black tracking-tight",
                          percentage > 90 ? 'text-green-600' : 'text-blue-600'
                        )}>
                          {Math.round(percentage)}%
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            // Non-BMU View (Check if we have capacity to show nice card)
            capacity ? (
              <div className="rounded-lg bg-slate-50 p-4 border border-slate-100 shadow-sm relative overflow-hidden">
                {/* Background Gloss */}
                <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-gradient-to-br from-white/80 to-transparent blur-2xl pointer-events-none" />

                <div className="relative z-10 flex flex-col gap-4">
                  {/* Hero Metric: Installed Capacity ONLY */}
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Installed Capacity
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xl font-black text-slate-900 tracking-tight leading-none">
                        {Math.round(capacity)}
                      </span>
                      <span className="text-sm font-bold text-slate-500">MW</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              // Fallback for Substations/Lines (Standard Grid converted to Card)
              <div className="rounded-lg bg-slate-50 p-4 border border-slate-100 shadow-sm relative overflow-hidden">
                <div className="relative z-10 flex flex-col gap-4">
                  {/* Try to find a Hero Metric (Voltage or First Row) */}
                  {(() => {
                    const voltageRow = info.rows.find(r => r.label === 'Voltage');
                    const primaryRow = voltageRow || info.rows[0];

                    if (primaryRow) {
                      return (
                        <div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                            {primaryRow.label}
                          </div>
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-lg font-black text-slate-900 tracking-tight leading-none truncate max-w-full block">
                              {primaryRow.value}
                            </span>
                          </div>
                        </div>
                      )
                    }
                    return <span className="text-sm text-slate-400 italic">No Data</span>
                  })()}
                </div>
              </div>
            )
          )}
        </div>

        {/* Footer Actions */}
        <Button
          onClick={onExpand}
          className="w-full justify-between group h-9 text-xs"
          variant="outline"
        >
          <span className="flex items-center gap-2">
            <Info className="h-3.5 w-3.5 text-muted-foreground" />
            View Details
          </span>
          <Search className="h-3 w-3 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Button>
      </div>
    </div>
  );
};
