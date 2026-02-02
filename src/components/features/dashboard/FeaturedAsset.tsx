import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/common/card';
import { Button } from '@/components/common/button';
import { Star, MapPin, Zap, FileText, Loader2, Map as MapIcon, Sparkles, Fan } from 'lucide-react';
import { fetchWikidataData } from '@/lib/api/wikidata';
import { fetchBmuGeneration, fetchBmuBoal } from '@/lib/api/elexon';
import { useAppStore } from '@/state/store';

interface FeaturedAssetProps {
    name?: string;
    type?: string;
    capacity?: number;
    location?: { lat: number; lng: number; description: string };
    imageUrl?: string;
    wikidataId?: string;
    description?: string;
    className?: string;
}

export const FeaturedAsset: React.FC<FeaturedAssetProps> = ({
    name = "Walney Wind Farm",
    type = "Wind",
    capacity = 1026,
    location = {
        lat: 54.1271,
        lng: -3.8537,
        description: "Located 15km off Walney Island, Cumbria, in the Irish Sea."
    },
    imageUrl = "https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Walney_Offshore_Windfarm_-_geograph.org.uk_-_2391702.jpg/1280px-Walney_Offshore_Windfarm_-_geograph.org.uk_-_2391702.jpg",
    description = "Managed by <Ørsted>, this facility comprises three interconnected projects: <Walney 1, Walney 2, and the Walney Extension>. The development represents a joint venture involving PGGM, Greencoat UK Wind, and Danish pension funds, with initial operations commencing in 2012.\n\nUtilizing a combination of <Siemens Gamesa and MHI Vestas turbines>, the infrastructure covers a seabed area of approximately <145km2>. Power generated is transmitted via subsea cables to the National Grid through onshore substations located at <Heysham> and <Stanah>.\n\nThe site serves as a regional employer, maintaining a dedicated operations and maintenance base in <Barrow-in-Furness>.",
    wikidataId = "Q1330226",
    className
}) => {
    const [currentOutput, setCurrentOutput] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isCurtailed, setIsCurtailed] = useState(false);
    const [resolvedImageUrl, setResolvedImageUrl] = useState(imageUrl);

    useEffect(() => {
        const loadData = async () => {
            if (!wikidataId) return;
            setIsLoading(true);
            try {
                // 1. Get BMU IDs from Wikidata
                const wikidataData = await fetchWikidataData(wikidataId);
                const bmuIds = wikidataData?.bmuIds || [];

                if (wikidataData?.imageUrl) {
                    setResolvedImageUrl(wikidataData.imageUrl);
                }

                if (bmuIds.length > 0) {
                    const now = new Date();
                    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
                    const to = now.toISOString();

                    // 2. Fetch Generation & BOAL Data
                    const [genData, boalData] = await Promise.all([
                        fetchBmuGeneration(bmuIds, from, to),
                        fetchBmuBoal(bmuIds, from, to)
                    ]);

                    // 3. Calculate Aggregated Output (Same logic as FeaturePopup)
                    if (genData && genData.length > 0) {
                        const nowTime = now.getTime();
                        let totalQuantity = 0;
                        let curtailed = false; // Track curtailment
                        const uniqueBmuIds = Array.from(new Set(bmuIds));

                        uniqueBmuIds.forEach(bmuId => {
                            // PN (Baseline)
                            const bmuPns = genData.filter(d => d.bmuId === bmuId);
                            const activePn = bmuPns
                                .filter(d => new Date(d.timeFrom).getTime() <= nowTime)
                                .sort((a, b) => new Date(b.timeFrom).getTime() - new Date(a.timeFrom).getTime())[0];
                            const pnLevel = activePn ? activePn.quantity : 0;

                            // BOAL (Override)
                            const bmuBoals = boalData?.filter(d => d.bmuId === bmuId) || [];
                            const activeBoalInst = bmuBoals.find(d => {
                                const start = new Date(d.timeFrom).getTime();
                                const end = new Date(d.timeTo).getTime();
                                return nowTime >= start && nowTime < end;
                            });

                            if (activeBoalInst) {
                                totalQuantity += activeBoalInst.levelFrom;
                                curtailed = true;
                            } else {
                                totalQuantity += pnLevel;
                            }
                        });

                        setCurrentOutput(Math.max(0, totalQuantity));
                        setIsCurtailed(curtailed);
                    }
                }
            } catch (err) {
                console.warn("Failed to load Featured Asset data", err);
            } finally {
                setIsLoading(false);
            }
        };

        loadData();
    }, [wikidataId]);

    const percentage = currentOutput !== null && capacity ? Math.min(100, (currentOutput / capacity) * 100) : 0;

    const navigate = useNavigate();
    const setSelectedSearchResult = useAppStore((state) => state.setSelectedSearchResult);

    const handleViewOnMap = () => {
        setSelectedSearchResult({
            id: wikidataId || name || 'featured-asset',
            name: name || 'Unknown Asset',
            asset_type: 'plant', // Assuming plant/generator for featured assets
            capacity: capacity,
            coordinates: location ? [location.lng, location.lat] : [0, 0],
            technology_type: type?.toLowerCase() || 'unknown'
        });
        navigate('/map');
    };

    return (
        <Card className={`h-full border-2 border-primary/10 shadow-lg relative overflow-hidden bg-gradient-to-b from-card to-muted/20 ${className || ''}`}>
            <div className="absolute top-0 right-0 p-4 z-10">
                <div className="flex items-center gap-1.5 bg-white/10 text-white px-3 py-1 rounded-full border border-white/20 backdrop-blur-sm">
                    <Star className="h-3.5 w-3.5 fill-white" />
                    <span className="text-xs font-bold tracking-wide uppercase">Featured Asset</span>
                </div>
            </div>

            {/* Hero Image */}
            <div className="h-64 w-full bg-slate-200 relative group overflow-hidden">
                {resolvedImageUrl ? (
                    <img
                        src={resolvedImageUrl}
                        alt={`${name} ${type} Farm`}
                        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                ) : (
                    <div className="h-full w-full bg-slate-200 flex items-center justify-center">
                        <Zap className="h-12 w-12 text-slate-300" />
                    </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-6">
                    <h2 className="text-2xl font-bold text-white leading-tight">{name}</h2>
                    <p className="text-slate-200 font-medium">{type === 'Wind' ? 'Offshore Wind Farm' : `${type} Power Station`}</p>
                </div>
            </div>

            <CardContent className="p-6 space-y-4">
                {/* Key Metrics Grid */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Capacity</p>
                        <div className="flex items-baseline gap-1">
                            <span className="text-3xl font-black text-foreground">{capacity.toLocaleString()}</span>
                            <span className="text-sm font-bold text-muted-foreground">MW</span>
                        </div>
                    </div>
                    <div className="space-y-1">
                        <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Type</p>
                        <div className="flex items-center gap-2">
                            {type === 'Wind' ? (
                                <Fan className="h-7 w-7 text-green-500" />
                            ) : (
                                <Zap className="h-7 w-7 text-amber-500" />
                            )}
                            <span className="text-3xl font-black text-foreground">{type}</span>
                        </div>
                    </div>
                </div>

                <div className="h-px w-full bg-border/50" />

                {/* Live Status (Placeholder) */}
                <div className="bg-muted/30 rounded-xl p-4 border border-border/50">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-semibold">Live Output Status</span>
                        {isLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : (
                            <span className={`flex h-2 w-2 rounded-full ${currentOutput !== null && currentOutput > 0 ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`} />
                        )}
                    </div>

                    <div className="space-y-3">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-muted-foreground">Current Output</span>
                            <span className="font-mono font-medium">
                                {isLoading ? (
                                    <span className="text-muted-foreground animate-pulse">Loading...</span>
                                ) : currentOutput !== null ? (
                                    <>
                                        {currentOutput.toLocaleString(undefined, { maximumFractionDigits: 1 })} <span className="text-xs text-muted-foreground">MW</span>
                                    </>
                                ) : (
                                    <span className="text-muted-foreground">-- MW</span>
                                )}
                            </span>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full bg-border/40 h-2 rounded-full overflow-hidden">
                            <div
                                className={`h-full transition-all duration-1000 ${isCurtailed ? 'bg-amber-400' : 'bg-green-500'}`}
                                style={{ width: `${percentage}%` }}
                            />
                        </div>

                        <div className="flex justify-between items-center pt-1">
                            <p className="text-xs text-muted-foreground">
                                {isCurtailed ? (
                                    <span className="text-amber-600 font-medium flex items-center gap-1">
                                        <Zap className="h-3 w-3" /> Curtailed (Grid Constraint)
                                    </span>
                                ) : (
                                    `${percentage.toFixed(1)}% of Capacity`
                                )}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="h-px w-full bg-border/50" />

                {/* Details Section: Description then Location */}
                <div className="space-y-3">
                    <div className="flex items-start gap-3">
                        <div className="h-8 w-8 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0">
                            <FileText className="h-4 w-4 text-indigo-600" />
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-semibold text-sm">Description</h4>
                                <div className="group relative flex items-center justify-center">
                                    <Sparkles className="h-3 w-3 text-amber-500 cursor-help" />
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-max max-w-[200px] bg-slate-900 text-white text-[10px] px-2 py-1 rounded shadow-lg text-center z-50">
                                        Content generated by AI
                                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900"></div>
                                    </div>
                                </div>
                            </div>
                            <div className="text-sm text-muted-foreground leading-relaxed text-pretty space-y-2">
                                {description ? description.split('\n\n').map((paragraph, i) => (
                                    <p key={i}>
                                        {paragraph.split(/(<[^>]+>)/g).map((part, j) => {
                                            if (part.startsWith('<') && part.endsWith('>')) {
                                                return <span key={j} className="font-semibold text-foreground">{part.slice(1, -1)}</span>;
                                            }
                                            return part;
                                        })}
                                    </p>
                                )) : null}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-start gap-3">
                        <div className="h-8 w-8 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0">
                            <MapPin className="h-4 w-4 text-blue-600" />
                        </div>
                        <div>
                            <h4 className="font-semibold text-sm">Location</h4>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                {location.description}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1 font-mono">
                                {location.lat.toFixed(4)}° N, {location.lng.toFixed(4)}° E
                            </p>
                        </div>
                    </div>
                </div>

                <Button
                    variant="outline"
                    className="w-full gap-2 border-primary/20 hover:bg-primary/5 hover:text-primary transition-colors"
                    onClick={handleViewOnMap}
                >
                    <MapIcon className="h-4 w-4" />
                    View on Map
                </Button>

            </CardContent>
        </Card>
    );
};
