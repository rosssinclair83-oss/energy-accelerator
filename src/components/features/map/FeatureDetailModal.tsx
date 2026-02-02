import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/common/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/common/card';
import { cn } from '@/lib/utils';
import type { PopupInfo } from './FeaturePopup';
import { Activity, Zap, MapPin, FileText, AlertTriangle } from 'lucide-react';
import { getMapboxSatelliteImageUrl } from '@/lib/api/satellite';
import {
    fetchBmuGeneration,
    fetchBmuBoal,
    fetchBmuMel,
    fetchBmuB1610,
    type BmuGenerationData,
    type BmuBoalData,
    type BmuMelData,
    type BmuB1610Data,
} from '@/lib/api/elexon';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';

interface FeatureDetailModalProps {
    info: PopupInfo | null;
    onClose: () => void;
}

type Tab = 'overview' | 'generation' | 'performance' | 'planning';
type HistoricalRange = '7d' | '1m' | '6m' | '1y' | '2y';

export const FeatureDetailModal = ({ info, onClose }: FeatureDetailModalProps) => {
    const [activeTab, setActiveTab] = useState<Tab>('overview');

    // Live/Recent Data State
    const [generationData, setGenerationData] = useState<BmuGenerationData[] | null>(null);
    const [boalData, setBoalData] = useState<BmuBoalData[] | null>(null);
    const [melData, setMelData] = useState<BmuMelData[] | null>(null);
    const [isLoadingGeneration, setIsLoadingGeneration] = useState(false);

    // Historical Data State
    const [historicalRange, setHistoricalRange] = useState<HistoricalRange>('1m');
    const [historicalData, setHistoricalData] = useState<BmuB1610Data[] | null>(null);
    const [isLoadingHistorical, setIsLoadingHistorical] = useState(false);

    const [selectedBmuId, setSelectedBmuId] = useState<string>('aggregated');

    // Simple in-component cache
    const [cachedBmuId, setCachedBmuId] = useState<string | null>(null);

    // Fetch Live/Recent Data
    useEffect(() => {
        const bmuIds = info?.bmuIds || (info?.bmuId ? [info.bmuId] : []);
        const bmuKey = bmuIds.sort().join(',');

        if (bmuIds.length > 0) {
            // Check cache for recent data
            if (cachedBmuId === bmuKey && generationData) {
                return;
            }

            setIsLoadingGeneration(true);
            const now = new Date();
            const from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(); // Last 24 hours
            const to = now.toISOString();

            Promise.all([
                fetchBmuGeneration(bmuIds, from, to),
                fetchBmuBoal(bmuIds, from, to),
                fetchBmuMel(bmuIds, from, to),
            ])
                .then(([genData, boalData, melData]) => {
                    setGenerationData(genData);
                    setBoalData(boalData);
                    setMelData(melData);
                    setCachedBmuId(bmuKey);
                })
                .catch((err) => console.error('Failed to fetch data', err))
                .finally(() => setIsLoadingGeneration(false));
        } else {
            setGenerationData(null);
            setBoalData(null);
            setMelData(null);
            setCachedBmuId(null);
        }
    }, [info?.bmuId, info?.bmuIds]);

    // Fetch Historical Data
    useEffect(() => {
        const bmuIds = info?.bmuIds || (info?.bmuId ? [info.bmuId] : []);
        if (bmuIds.length === 0 || activeTab !== 'generation') return;

        setIsLoadingHistorical(true);
        const now = new Date();
        let fromDate = new Date();
        let toDate = new Date();

        switch (historicalRange) {
            case '7d':
                toDate.setDate(now.getDate() - 7);
                fromDate.setDate(toDate.getDate() - 7);
                break;
            case '1m':
                fromDate.setMonth(now.getMonth() - 1);
                break;
            case '6m':
                fromDate.setMonth(now.getMonth() - 6);
                break;
            case '1y':
                fromDate.setFullYear(now.getFullYear() - 1);
                break;
            case '2y':
                fromDate.setFullYear(now.getFullYear() - 2);
                break;
        }

        fetchBmuB1610(bmuIds, fromDate.toISOString(), toDate.toISOString())
            .then((data) => {
                setHistoricalData(data);
            })
            .catch((err) => console.error('Failed to fetch historical data', err))
            .finally(() => setIsLoadingHistorical(false));
    }, [activeTab, historicalRange, info?.bmuId, info?.bmuIds]);

    const getDisplayedData = () => {
        if (!generationData || generationData.length === 0) return null;

        const targetBmuIds =
            selectedBmuId === 'aggregated'
                ? Array.from(new Set(generationData.map((d) => d.bmuId)))
                : [selectedBmuId];

        // 1. Filter Data for selected BMUs
        const activePn = generationData.filter((d) => targetBmuIds.includes(d.bmuId));
        const activeBoal = boalData?.filter((d) => targetBmuIds.includes(d.bmuId)) || [];
        const activeMel = melData?.filter((d) => targetBmuIds.includes(d.bmuId)) || [];

        // 2. Collection Unique Time Points
        const timeSet = new Set<number>();

        // Helper to add times
        const addTime = (t: string) => timeSet.add(new Date(t).getTime());

        activePn.forEach((d) => {
            addTime(d.timeFrom);
            if (d.timeTo) addTime(d.timeTo);
        });
        activeBoal.forEach((d) => {
            addTime(d.timeFrom);
            addTime(d.timeTo);
        });
        activeMel.forEach((d) => {
            addTime(d.timeFrom);
            addTime(d.timeTo);
        });

        // Add 'now' to ensure graph goes to present
        const nowMs = new Date().getTime();
        timeSet.add(nowMs);

        const sortedTimes = Array.from(timeSet).sort((a, b) => a - b);

        // Filter times to be within the fetched window (approx last 24h)
        // We use the earliest PN time as the start anchor
        if (activePn.length === 0) return [];
        const earliestTime = new Date(activePn[0].timeFrom).getTime() - 30 * 60 * 1000; // 30 min buffer
        const validTimes = sortedTimes.filter((t) => t >= earliestTime && t <= nowMs);

        // 3. Process each time point
        const timeSeries: any[] = [];

        validTimes.forEach((t) => {
            let actualTotal = 0;
            let potentialTotal = 0;
            let curtailmentTotal = 0;

            targetBmuIds.forEach((id) => {
                // 1. PN (Baseline)
                const bmuPns = activePn.filter((d) => d.bmuId === id);
                // Find latest PN starting before or at t
                const displayPn = bmuPns
                    .filter((d) => new Date(d.timeFrom).getTime() <= t)
                    .sort((a, b) => new Date(b.timeFrom).getTime() - new Date(a.timeFrom).getTime())[0];
                const pnLevel = displayPn ? displayPn.quantity : 0;

                // 2. MEL (Max)
                const bmuMels = activeMel.filter((d) => d.bmuId === id);
                const displayMel = bmuMels
                    .filter((d) => new Date(d.timeFrom).getTime() <= t)
                    .sort((a, b) => new Date(b.timeFrom).getTime() - new Date(a.timeFrom).getTime())[0];
                const melLevel = displayMel ? displayMel.levelFrom : 0; // Default 0 or infinity? 0 seems safer for "potential"

                // 3. BOAL (Override)
                const bmuBoals = activeBoal.filter((d) => d.bmuId === id);
                const activeBoalInst = bmuBoals.find((d) => {
                    const start = new Date(d.timeFrom).getTime();
                    const end = new Date(d.timeTo).getTime();
                    return t >= start && t < end;
                });

                // Logic: Actual = BOAL if active, else PN
                const actual = activeBoalInst ? activeBoalInst.levelFrom : pnLevel;

                // Logic: Curtailment = PN - Actual (if positive)
                const curtailment = Math.max(0, pnLevel - actual);

                // Logic: Potential = Max(PN, MEL)
                const potential = Math.max(pnLevel, melLevel);

                actualTotal += actual;
                potentialTotal += potential;
                curtailmentTotal += curtailment;
            });

            timeSeries.push({
                timeFrom: new Date(t).toISOString(),
                actual: actualTotal,
                potential: potentialTotal,
                curtailment: curtailmentTotal,
            });
        });

        return timeSeries;
    };

    const getHistoricalDisplayedData = () => {
        if (!historicalData || historicalData.length === 0) return [];

        const targetBmuIds =
            selectedBmuId === 'aggregated'
                ? Array.from(new Set(historicalData.map((d) => d.bmuId)))
                : [selectedBmuId];

        // Filter by BMU
        const filtered = historicalData.filter((d) => targetBmuIds.includes(d.bmuId));

        // Group by settlement date/period (basically time)
        const rawPoints = filtered.map((d) => {
            const dateParts = d.settlementDate.split('-');
            const date = new Date(
                Date.UTC(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2])),
            );
            // Add period offset
            const t = (d as any).timeFrom
                ? new Date((d as any).timeFrom).getTime()
                : date.getTime() + (d.settlementPeriod - 1) * 30 * 60 * 1000;

            return {
                time: t,
                quantity: d.quantity,
            };
        });

        // Sort by time
        rawPoints.sort((a, b) => a.time - b.time);

        // 1. Aggregate per timestamp (Summing across BMUs to get Plant Total at that instant)
        const instantMap = new Map<number, number>();
        rawPoints.forEach((p) => {
            const current = instantMap.get(p.time) || 0;
            instantMap.set(p.time, current + p.quantity);
        });

        const sortedInstants = Array.from(instantMap.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([time, quantity]) => ({
                time,
                // Convert MW to MWh for the 30-min settlement period
                quantity: quantity // Already MWh per settlement period
            }));

        // 2. Aggregate into Time Buckets (Summing MWh over the period)
        const bucketMap = new Map<number, number>();

        sortedInstants.forEach((item) => {
            const d = new Date(item.time);
            let bucketTime: number;

            switch (historicalRange) {
                case '7d':
                    bucketTime = item.time;
                    break;
                case '1m': // Daily
                    d.setHours(0, 0, 0, 0);
                    bucketTime = d.getTime();
                    break;
                case '6m': // Weekly (Start Monday)
                    {
                        const day = d.getDay();
                        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
                        d.setDate(diff);
                        d.setHours(0, 0, 0, 0);
                        bucketTime = d.getTime();
                    }
                    break;
                case '1y': // 2-Weekly
                    {
                        // Get Start of week first
                        const day = d.getDay();
                        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                        d.setDate(diff);
                        d.setHours(0, 0, 0, 0);

                        // Now align to 2-week epoch
                        // Arbitrary epoch: Jan 1 1970 (Thursday).
                        // Let's just use the timestamp and floor division by 14 days relative to a known Monday.
                        const mondayEpoch = new Date('1970-01-05T00:00:00Z').getTime();
                        const msPer2Weeks = 14 * 24 * 60 * 60 * 1000;
                        const time = d.getTime();
                        const offset = time - mondayEpoch;
                        const twoWeekIndex = Math.floor(offset / msPer2Weeks);
                        bucketTime = mondayEpoch + twoWeekIndex * msPer2Weeks;
                    }
                    break;
                case '2y': // Monthly
                    d.setDate(1);
                    d.setHours(0, 0, 0, 0);
                    bucketTime = d.getTime();
                    break;
                default:
                    bucketTime = item.time;
            }

            const currentSum = bucketMap.get(bucketTime) || 0;
            bucketMap.set(bucketTime, currentSum + item.quantity);
        });

        const aggregatedData = Array.from(bucketMap.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([time, sum]) => ({
                time,
                quantity: Math.round(sum), // Total MWh over the period
            }));

        return aggregatedData;
    };

    const getSparklineData = (fullData: any[]) => {
        if (!fullData || fullData.length === 0) return [];
        // Simply take last 50 points or resample
        const count = fullData.length;
        if (count <= 50) return fullData;

        const step = Math.ceil(count / 50);
        const downsampled = [];
        for (let i = 0; i < count; i += step) {
            downsampled.push(fullData[i]);
        }
        // Ensure last point is included
        if (downsampled[downsampled.length - 1] !== fullData[count - 1]) {
            downsampled.push(fullData[count - 1]);
        }
        return downsampled;
    };

    const displayedData = getDisplayedData();
    const sparklineData = displayedData ? getSparklineData(displayedData) : [];
    const latestDataPoint =
        displayedData && displayedData.length > 0 ? displayedData[displayedData.length - 1] : null;
    const historicalDisplayedData = getHistoricalDisplayedData();

    const bmuIds = info?.bmuIds || (info?.bmuId ? [info.bmuId] : []);

    const getCapacity = () => {
        if (!info) return null;
        const capacityRow = info.rows.find((r) => r.label === 'Capacity' || r.label === 'Output');
        if (!capacityRow) return null;
        const match = capacityRow.value.match(/([\d,.]+)/);
        return match ? parseFloat(match[1].replace(/,/g, '')) : null;
    };

    const capacity = getCapacity();
    const percentage = latestDataPoint && capacity ? (latestDataPoint.actual / capacity) * 100 : null;

    const tabs: { id: Tab; label: string }[] = [
        { id: 'overview', label: 'Overview' },
        { id: 'generation', label: 'Generation' },
        { id: 'performance', label: 'Performance' },
        { id: 'planning', label: 'Planning' },
    ];

    if (!info) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                    onClick={onClose}
                />
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    className="relative flex flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
                    style={{ width: '80vw', height: '80vh', maxWidth: '1200px', maxHeight: '900px' }}
                >
                    {/* Header Area */}
                    <div className="flex h-32 shrink-0 border-b border-border bg-card">
                        {/* Content Section (Title & Tabs) */}
                        <div className="flex flex-1 flex-col min-w-0">
                            {/* Top Row: Title & Close Button */}
                            <div className="flex items-start justify-between p-6 pb-2">
                                <div className="space-y-1 pr-4">
                                    <h2 className="text-2xl font-bold leading-tight text-foreground">{info.title}</h2>
                                    {info.subtitle && (
                                        <p className="text-sm text-muted-foreground">{info.subtitle}</p>
                                    )}
                                </div>
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                                    onClick={onClose}
                                >
                                    <X className="h-5 w-5" />
                                    <span className="sr-only">Close</span>
                                </Button>
                            </div>

                            {/* Bottom Row: Tabs */}
                            <div className="mt-auto flex px-6">
                                {tabs.map((tab) => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id)}
                                        className={cn(
                                            'relative px-4 py-3 text-sm font-medium transition-colors hover:text-foreground',
                                            activeTab === tab.id ? 'text-foreground' : 'text-muted-foreground',
                                        )}
                                    >
                                        {tab.label}
                                        {activeTab === tab.id && (
                                            <motion.div
                                                layoutId="activeTab"
                                                className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                                            />
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Content Area */}
                    <div className="flex-1 overflow-y-auto bg-background p-8">
                        {activeTab === 'overview' && (
                            <div className="space-y-6">
                                {/* Top Row: Status, Capacity, Live Output */}
                                <div className="grid gap-6 md:grid-cols-3">
                                    <Card>
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                                                <Activity className="h-4 w-4" />
                                                STATUS
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="text-2xl font-bold text-green-600">Operational</div>
                                            <div className="text-sm text-muted-foreground">
                                                Since {(info.properties?.['start_date'] as string) || 'N/A'}
                                            </div>
                                        </CardContent>
                                    </Card>
                                    <Card>
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                                                <Zap className="h-4 w-4" />
                                                INSTALLED CAPACITY
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="text-2xl font-bold">
                                                {info.rows.find((r) => r.label === 'Capacity' || r.label === 'Output')
                                                    ?.value || 'N/A'}
                                            </div>
                                        </CardContent>
                                    </Card>
                                    <Card className="bg-slate-900 text-white border-none">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-sm font-medium text-slate-400 flex items-center gap-2">
                                                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                                                LIVE OUTPUT
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            {bmuIds.length > 0 ? (
                                                <>
                                                    <div className="flex items-baseline gap-2">
                                                        <span className="text-2xl font-bold">
                                                            {latestDataPoint ? `${latestDataPoint.actual} MW` : 'Loading...'}
                                                        </span>
                                                        {percentage !== null && (
                                                            <span
                                                                className={cn(
                                                                    'text-sm font-medium px-1.5 py-0.5 rounded',
                                                                    percentage > 90
                                                                        ? 'bg-green-500/20 text-green-300'
                                                                        : percentage > 50
                                                                            ? 'bg-blue-500/20 text-blue-300'
                                                                            : 'bg-slate-700 text-slate-300',
                                                                )}
                                                            >
                                                                {percentage.toFixed(1)}%
                                                            </span>
                                                        )}
                                                        <span className="text-sm text-slate-400 ml-auto">Current</span>
                                                    </div>
                                                    {sparklineData && sparklineData.length > 0 && (
                                                        <div className="mt-4 h-12 w-full bg-slate-800/50 rounded flex items-center justify-center">
                                                            <div className="w-full h-full px-2 py-1">
                                                                <ResponsiveContainer width="100%" height="100%">
                                                                    <AreaChart data={sparklineData}>
                                                                        <Area
                                                                            type="stepAfter"
                                                                            dataKey="actual"
                                                                            stroke="#22c55e"
                                                                            fill="#22c55e"
                                                                            fillOpacity={0.2}
                                                                            strokeWidth={2}
                                                                            isAnimationActive={false}
                                                                        />
                                                                    </AreaChart>
                                                                </ResponsiveContainer>
                                                            </div>
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                <div className="flex flex-col items-center justify-center h-[88px] text-slate-400">
                                                    <AlertTriangle className="h-6 w-6 mb-2 text-amber-500" />
                                                    <span className="text-sm font-medium">
                                                        Operational data not available
                                                    </span>
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                </div>

                                {/* Middle Row: Identity, Technical, Location */}
                                <div className="grid gap-6 md:grid-cols-3">
                                    {/* Identity & Ownership */}
                                    <Card>
                                        <CardHeader>
                                            <CardTitle className="text-base flex items-center gap-2">
                                                <FileText className="h-4 w-4" />
                                                Identity & Ownership
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            <div>
                                                <div className="text-sm text-muted-foreground">Operator</div>
                                                <div className="font-medium">
                                                    {(info.properties?.['operator'] as string) || 'Unknown'}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-sm text-muted-foreground">Ownership Structure</div>
                                                <div className="font-medium">
                                                    {(info.properties?.['owner'] as string) || 'Unknown'}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-sm text-muted-foreground mb-1">Asset Type</div>
                                                <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                                                    {(info.properties?.['plant:source'] as string) || 'Power Plant'}
                                                </span>
                                            </div>
                                            <div>
                                                <div className="text-sm text-muted-foreground mb-1">REPD ID</div>
                                                <span className="inline-flex items-center rounded-md bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10">
                                                    {(info.properties?.['repd:id'] as string) || 'N/A'}
                                                </span>
                                            </div>
                                            {bmuIds.length > 0 && (
                                                <div>
                                                    <div className="text-sm text-muted-foreground mb-1">BMU IDs</div>
                                                    <div className="flex flex-wrap gap-1">
                                                        {bmuIds.map((id) => (
                                                            <span
                                                                key={id}
                                                                className="inline-flex items-center rounded-md bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700 ring-1 ring-inset ring-purple-700/10"
                                                            >
                                                                {id}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>

                                    {/* Technical & Grid */}
                                    <Card>
                                        <CardHeader>
                                            <CardTitle className="text-base flex items-center gap-2">
                                                <Zap className="h-4 w-4" />
                                                Technical & Grid
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            <div>
                                                <div className="text-sm text-muted-foreground">Technology Details</div>
                                                <div className="font-medium">
                                                    {info.properties?.['turbines']
                                                        ? `${info.properties['turbines']} Turbines`
                                                        : 'Details unavailable'}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-sm text-muted-foreground">Grid Connection Point</div>
                                                <div className="font-medium">Unknown</div>
                                            </div>
                                            <div>
                                                <div className="text-sm text-muted-foreground">Connection Voltage</div>
                                                <div className="font-medium">
                                                    {info.rows.find((r) => r.label === 'Voltage')?.value || 'N/A'}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-sm text-muted-foreground">Grid Zone</div>
                                                <div className="font-medium">National Grid ESO</div>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    {/* Location Context */}
                                    <Card className="h-full flex flex-col">
                                        <CardHeader>
                                            <CardTitle className="text-base flex items-center gap-2">
                                                <MapPin className="h-4 w-4" />
                                                Location Context
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-4 flex-1 flex flex-col">
                                            <div className="relative w-full flex-1 min-h-[200px] overflow-hidden rounded-md bg-muted">
                                                {info.coordinates ? (
                                                    <img
                                                        src={getMapboxSatelliteImageUrl(
                                                            info.coordinates[1],
                                                            info.coordinates[0],
                                                            {
                                                                width: 600,
                                                                height: 600,
                                                                zoom: info.zoom,
                                                            },
                                                        )}
                                                        alt="Satellite View"
                                                        className="absolute inset-0 h-full w-full object-cover"
                                                    />
                                                ) : (
                                                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                                                        <MapPin className="mr-2 h-4 w-4" />
                                                        Satellite View
                                                    </div>
                                                )}
                                                <div className="absolute bottom-2 right-2 rounded bg-black/50 px-2 py-1 text-xs text-white">
                                                    {info.coordinates
                                                        ? `${info.coordinates[1].toFixed(4)}, ${info.coordinates[0].toFixed(4)}`
                                                        : 'Coordinates N/A'}
                                                </div>
                                            </div>
                                            <div className="flex justify-between items-center shrink-0">
                                                <span className="text-sm text-muted-foreground">Region</span>
                                                <span className="font-medium">Yorkshire and the Humber</span>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </div>

                                {/* Bottom Actions */}
                                <div className="flex items-center justify-between pt-4 border-t border-border">
                                    <div className="flex gap-4">
                                        <Button className="gap-2 bg-blue-600 hover:bg-blue-700">
                                            <FileText className="h-4 w-4" />
                                            Download Datasheet
                                        </Button>
                                        <Button variant="outline" className="gap-2">
                                            <FileText className="h-4 w-4" />
                                            View Planning Application
                                        </Button>
                                    </div>
                                    <Button
                                        variant="outline"
                                        className="gap-2 text-amber-600 hover:text-amber-700 hover:bg-amber-50 border-amber-200"
                                    >
                                        <AlertTriangle className="h-4 w-4" />
                                        Report Data Issue
                                    </Button>
                                </div>
                            </div>
                        )}
                        {activeTab === 'generation' && (
                            <div className="space-y-6">
                                {/* Live/Recent Generation Card */}
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-base flex items-center gap-2">
                                            <div className="flex items-center gap-2">
                                                <Activity className="h-4 w-4" />
                                                Generation (Last 24 Hours)
                                            </div>
                                            <div className="ml-auto text-sm font-normal text-muted-foreground">
                                                Event-Driven Graph
                                            </div>
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        {isLoadingGeneration ? (
                                            <div className="flex items-center justify-center h-64">
                                                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                                            </div>
                                        ) : displayedData && displayedData.length > 0 ? (
                                            <div className="space-y-6">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-baseline gap-4">
                                                        <div>
                                                            <div className="text-sm text-muted-foreground">Latest Actual</div>
                                                            <div className="text-3xl font-bold text-primary">
                                                                {latestDataPoint?.actual} MW
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <div className="text-sm text-muted-foreground">Potential</div>
                                                            <div className="text-xl font-semibold text-gray-500">
                                                                {latestDataPoint?.potential} MW
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {bmuIds.length > 1 && (
                                                        <select
                                                            value={selectedBmuId}
                                                            onChange={(e) => setSelectedBmuId(e.target.value)}
                                                            className="block w-48 rounded-md border-0 py-1.5 pl-3 pr-10 text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-indigo-600 sm:text-sm sm:leading-6"
                                                        >
                                                            <option value="aggregated">Aggregated</option>
                                                            {bmuIds.map((id) => (
                                                                <option key={id} value={id}>
                                                                    {id}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    )}
                                                </div>

                                                <div className="h-[400px] w-full">
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <AreaChart data={displayedData}>
                                                            <defs>
                                                                <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                                                                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.8} />
                                                                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                                                                </linearGradient>
                                                                <linearGradient id="colorPotential" x1="0" y1="0" x2="0" y2="1">
                                                                    <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.4} />
                                                                    <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
                                                                </linearGradient>
                                                                <linearGradient id="colorCurtailment" x1="0" y1="0" x2="0" y2="1">
                                                                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.8} />
                                                                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                                                                </linearGradient>
                                                            </defs>
                                                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                                            <XAxis
                                                                dataKey="timeFrom"
                                                                tickFormatter={(value) => {
                                                                    const date = new Date(value);
                                                                    return date.toLocaleTimeString([], {
                                                                        hour: '2-digit',
                                                                        minute: '2-digit',
                                                                    });
                                                                }}
                                                                stroke="#888888"
                                                                fontSize={12}
                                                                tickLine={false}
                                                                axisLine={false}
                                                            />
                                                            <YAxis
                                                                stroke="#888888"
                                                                fontSize={12}
                                                                tickLine={false}
                                                                axisLine={false}
                                                                tickFormatter={(value) => `${value} MW`}
                                                            />
                                                            <Tooltip
                                                                contentStyle={{
                                                                    backgroundColor: 'white',
                                                                    borderRadius: '8px',
                                                                    border: '1px solid #e5e7eb',
                                                                }}
                                                                labelFormatter={(value) => new Date(value).toLocaleString()}
                                                                formatter={(value: any, name: string | undefined) => {
                                                                    if (name === 'curtailment')
                                                                        return [`${value} MW`, 'Curtailed Volume'];
                                                                    if (name === 'actual') return [`${value} MW`, 'Actual Output'];
                                                                    if (name === 'potential') return [`${value} MW`, 'Potential'];
                                                                    return [`${value} MW`, name];
                                                                }}
                                                            />
                                                            <Area
                                                                type="stepAfter"
                                                                dataKey="potential"
                                                                stroke="#94a3b8"
                                                                strokeWidth={1}
                                                                strokeDasharray="4 4"
                                                                fill="url(#colorPotential)"
                                                                fillOpacity={0.5}
                                                            />
                                                            <Area
                                                                type="stepAfter"
                                                                dataKey="actual"
                                                                stackId="1"
                                                                stroke="#2563eb"
                                                                strokeWidth={2}
                                                                fill="url(#colorActual)"
                                                            />
                                                            <Area
                                                                type="stepAfter"
                                                                dataKey="curtailment"
                                                                stackId="1"
                                                                stroke="#f59e0b"
                                                                strokeWidth={0}
                                                                fill="url(#colorCurtailment)"
                                                            />
                                                        </AreaChart>
                                                    </ResponsiveContainer>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                                                <p>No data displayed.</p>
                                                {bmuIds.length === 0 && <p className="text-xs mt-1">(No BMU ID found)</p>}
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>

                                {/* Historical Generation Section */}
                                <Card>
                                    <CardHeader>
                                        <div className="flex items-center justify-between">
                                            <CardTitle className="text-base flex items-center gap-2">
                                                <Activity className="h-4 w-4" />
                                                Historical Generation
                                            </CardTitle>
                                            <select
                                                className="block rounded-md border-0 py-1.5 pl-3 pr-10 text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-indigo-600 sm:text-sm sm:leading-6"
                                                value={historicalRange}
                                                onChange={(e) => setHistoricalRange(e.target.value as any)}
                                            >
                                                <option value="7d">Last 7 Days</option>
                                                <option value="1m">Last Month</option>
                                                <option value="6m">Last 6 Months</option>
                                                <option value="1y">Last Year</option>
                                                <option value="2y">Last 2 Years</option>
                                            </select>
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        {isLoadingHistorical ? (
                                            <div className="flex items-center justify-center h-64">
                                                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                                            </div>
                                        ) : historicalDisplayedData && historicalDisplayedData.length > 0 ? (
                                            <div className="h-[400px] w-full">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <AreaChart data={historicalDisplayedData}>
                                                        <defs>
                                                            <linearGradient id="colorHistorical" x1="0" y1="0" x2="0" y2="1">
                                                                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8} />
                                                                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                                            </linearGradient>
                                                        </defs>
                                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                                        <XAxis
                                                            dataKey="time"
                                                            tickFormatter={(value) => {
                                                                const date = new Date(value);
                                                                if (historicalRange === '1m') {
                                                                    return date.toLocaleDateString(undefined, {
                                                                        month: 'short',
                                                                        day: 'numeric',
                                                                    });
                                                                }
                                                                if (historicalRange === '2y') {
                                                                    return date.toLocaleDateString(undefined, {
                                                                        month: 'short',
                                                                        year: '2-digit',
                                                                    });
                                                                }
                                                                return date.toLocaleDateString(undefined, {
                                                                    month: 'short',
                                                                    day: 'numeric',
                                                                });
                                                            }}
                                                            stroke="#888888"
                                                            fontSize={12}
                                                            tickLine={false}
                                                            axisLine={false}
                                                        />
                                                        <YAxis
                                                            stroke="#888888"
                                                            fontSize={12}
                                                            tickLine={false}
                                                            axisLine={false}
                                                            tickFormatter={(value) => `${value}`}
                                                        />
                                                        <Tooltip
                                                            contentStyle={{
                                                                backgroundColor: 'white',
                                                                borderRadius: '8px',
                                                                border: '1px solid #e5e7eb',
                                                            }}
                                                            labelFormatter={(value) => {
                                                                const date = new Date(value);
                                                                if (historicalRange === '7d') {
                                                                    return date.toLocaleString(undefined, {
                                                                        weekday: 'short',
                                                                        day: 'numeric',
                                                                        hour: '2-digit',
                                                                        minute: '2-digit',
                                                                    });
                                                                }
                                                                if (historicalRange === '2y') {
                                                                    return date.toLocaleDateString(undefined, {
                                                                        month: 'long',
                                                                        year: 'numeric',
                                                                    });
                                                                }
                                                                return date.toLocaleDateString(undefined, {
                                                                    weekday: 'short',
                                                                    month: 'short',
                                                                    day: 'numeric',
                                                                    year: 'numeric',
                                                                });
                                                            }}
                                                            formatter={(value: any) => [`${value} MWh`, 'Generation']}
                                                        />
                                                        <Area
                                                            type="monotone"
                                                            dataKey="quantity"
                                                            stroke="#8b5cf6"
                                                            strokeWidth={2}
                                                            fill="url(#colorHistorical)"
                                                        />
                                                    </AreaChart>
                                                </ResponsiveContainer>
                                            </div>
                                        ) : (
                                            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                                                <p>No historical data available.</p>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            </div>
                        )}
                        {activeTab !== 'overview' && activeTab !== 'generation' && (
                            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border p-12 text-center">
                                <div className="max-w-md space-y-2">
                                    <h3 className="text-lg font-semibold text-foreground">
                                        {tabs.find((t) => t.id === activeTab)?.label}
                                    </h3>
                                    <p className="text-muted-foreground">This section is under development.</p>
                                </div>
                            </div>
                        )}
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};
