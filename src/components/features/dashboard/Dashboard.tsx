import React, { useEffect, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell, LineChart, Line, ReferenceLine
} from 'recharts';
import { Activity, PieChart as PieChartIcon, PoundSterling, Gauge, Leaf } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/common/card';
import { FeaturedAsset } from '@/components/features/dashboard/FeaturedAsset';
import { fetchGenerationOutturnSummary, fetchSystemPrice, fetchSystemFrequency, type SystemFrequencyData } from '@/lib/api/elexon';
import { fetchCurrentCarbonIntensity, fetchDayCarbonIntensity, type CarbonIntensityData } from '@/lib/api/carbon';

// Helper to map fuel types to consistent colors
const FUEL_COLORS: Record<string, string> = {
  'GAS': '#f97316', // Orange (CCGT + OCGT)
  'NUCLEAR': '#3b82f6', // Blue
  'WIND': '#22c55e', // Green
  'SOLAR': '#eab308', // Yellow
  'BIOMASS': '#a855f7', // Purple
  'HYDRO': '#06b6d4', // Cyan (Includes NPSHYD, PS)
  'INTERCONNECTORS': '#1e293b', // Dark Slate (All INT*)
  'OTHER': '#ef4444', // Red
};

// Fallback color
const DEFAULT_COLOR = '#9ca3af';

interface DashboardProps {
  className?: string;
}

export const Dashboard: React.FC<DashboardProps> = ({ className }) => {
  const [generationData, setGenerationData] = useState<any[]>([]);
  const [pieChartData, setPieChartData] = useState<any[]>([]);
  const [systemPrices, setSystemPrices] = useState<{ buy: number, sell: number } | null>(null);
  const [frequencyData, setFrequencyData] = useState<SystemFrequencyData[]>([]);
  const [currentFrequency, setCurrentFrequency] = useState<number | null>(null);
  const [carbonData, setCarbonData] = useState<any[]>([]);
  const [currentCarbon, setCurrentCarbon] = useState<CarbonIntensityData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeFuels, setActiveFuels] = useState<string[]>([]);
  const [lastSettlementInfo, setLastSettlementInfo] = useState<{ date: string, period: number } | null>(null);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        // Fetch generation summary 
        const responseData = await fetchGenerationOutturnSummary(yesterday.toISOString(), now.toISOString());

        // Process Graph Data
        const timeMap = new Map<string, any>();
        const fuelsFound = new Set<string>();

        const validData = Array.isArray(responseData) ? responseData : [];

        validData.forEach((snapshot: any) => {
          const t = snapshot.startTime;
          if (!t) return;

          if (!timeMap.has(t)) {
            timeMap.set(t, { time: t, total: 0 });
          }
          const entry = timeMap.get(t);

          const fuelRecords = Array.isArray(snapshot.data) ? snapshot.data : [snapshot];

          fuelRecords.forEach((record: any) => {
            if (!record || !record.fuelType) return;

            let fuel = record.fuelType.trim();

            // Filtering Logic: Remove COAL and OIL
            if (fuel === 'COAL' || fuel === 'OIL') {
              return;
            }

            // Grouping Logic
            if (fuel.startsWith('INT')) {
              fuel = 'INTERCONNECTORS';
            } else if (fuel === 'CCGT' || fuel === 'OCGT') {
              fuel = 'GAS';
            } else if (fuel === 'NPSHYD' || fuel === 'PS') {
              fuel = 'HYDRO';
            }

            let qty = record.generation;

            if (typeof qty === 'string') qty = parseFloat(qty);
            if (isNaN(qty)) qty = 0;

            fuelsFound.add(fuel);

            const current = entry[fuel] || 0;
            entry[fuel] = current + qty;
          });
        });

        // Ensure every Time entry has all Fuels (fill with 0) 
        const allFuels = Array.from(fuelsFound);
        timeMap.forEach(entry => {
          let total = 0;
          allFuels.forEach(f => {
            if (entry[f] === undefined || entry[f] === null) {
              entry[f] = 0;
            }
            total += entry[f];
          });
          entry.total = total;
        });

        const processed = Array.from(timeMap.values())
          .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

        setGenerationData(processed);
        setActiveFuels(allFuels);

        // Process Pie Chart Data (Most recent entry)
        const currentGraphData = processed.length > 0 ? processed[processed.length - 1] : null;
        const sortedFuels = [...allFuels].sort();

        const pieData = currentGraphData
          ? sortedFuels
            .map(fuel => ({
              name: fuel,
              value: currentGraphData[fuel] || 0,
              color: FUEL_COLORS[fuel] || DEFAULT_COLOR
            }))
            .filter(d => d.value > 0)
            .sort((a, b) => b.value - a.value)
          : [];
        setPieChartData(pieData);


        // Fetch System Price
        const dateStr = new Date().toISOString().split('T')[0];
        const priceData = await fetchSystemPrice(dateStr);

        if (priceData && priceData.length > 0) {
          const latest = priceData[0];
          setSystemPrices({
            buy: latest.systemBuyPrice,
            sell: latest.systemSellPrice
          });
          setLastSettlementInfo({
            date: latest.settlementDate,
            period: latest.settlementPeriod
          });
        } else {
          // Fallback to yesterday
          const yest = new Date();
          yest.setDate(yest.getDate() - 1);
          const yestStr = yest.toISOString().split('T')[0];
          const priceDataYest = await fetchSystemPrice(yestStr);

          if (priceDataYest && priceDataYest.length > 0) {
            const latest = priceDataYest[0];
            setSystemPrices({
              buy: latest.systemBuyPrice,
              sell: latest.systemSellPrice
            });
            setLastSettlementInfo({
              date: latest.settlementDate,
              period: latest.settlementPeriod
            });
          } else {
            setSystemPrices(null);
          }
        }

        // Fetch System Frequency
        // 1 hour ago to 5 mins into future to catch latest
        const freqFrom = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
        const freqTo = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

        const freqData = await fetchSystemFrequency(freqFrom, freqTo);
        if (freqData.length > 0) {
          // Sort ascending by time for graph
          const sortedFreq = freqData.sort((a, b) => new Date(a.measurementTime).getTime() - new Date(b.measurementTime).getTime());

          // Downsample if needed (too many points for 1 hour? usually 1 sec resolution is too much, but let's see)
          // 1 hour = 3600 points. Recharts might be slow. Let's take every 15th point (15s resolution) or similar if sparse logic needed.
          // For now, let's just pass it.
          setFrequencyData(sortedFreq);
          setCurrentFrequency(sortedFreq[sortedFreq.length - 1].frequency);
        }

        // Fetch Carbon Intensity
        const currentC = await fetchCurrentCarbonIntensity();
        setCurrentCarbon(currentC);

        const dayC = await fetchDayCarbonIntensity(now);
        // Process dayC for graph: It needs to be 00:00 - 24:00
        // We might need to ensure we have the whole day coverage or just what is returned.
        // API usually returns the rolling 24h or current UTC day. Let's check dates.
        // Actually the endpoint /intensity/date/YYYY-MM-DD returns 30min periods for that whole day.

        // Map to graph format suitable for recharts
        // We want to distinguish actual vs forecast. 
        // Typically past is actual, future is forecast. 

        const processCarbonGraph = (data: CarbonIntensityData[]) => {
          return data.map(d => {
            return {
              time: d.from,
              actual: d.intensity.actual,
              forecast: d.intensity.forecast,
            };
          });
        };
        setCarbonData(processCarbonGraph(dayC));

      } catch (err) {
        console.error("Failed to fetch dashboard data", err);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, []);

  // Sort fuels
  const sortedFuels = [...activeFuels].sort();
  const totalCurrentGeneration = pieChartData.reduce((acc, curr) => acc + curr.value, 0);

  return (
    // Added 'pt-24' for navbar clearance, 'pl-16' for sidebar
    <div className={`p-8 pl-16 pt-24 w-full ${className || ''}`}>
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">National Grid Dashboard</h1>
            <p className="text-muted-foreground">Real-time energy generation and system status</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Live Data
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">

          {/* LEFT COLUMN: Main Dashboard (Shifted) */}
          <div className="xl:col-span-2 space-y-6">
            <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
              {/* Generation Mix Graph */}
              <Card className="lg:col-span-2 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-primary" />
                    Generation Mix (Last 24 Hours)
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Breakdown of electricity generation by fuel type
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="h-[400px] w-full">
                    {isLoading ? (
                      <div className="flex h-full items-center justify-center">
                        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                      </div>
                    ) : generationData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={generationData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                          <defs>
                            {sortedFuels.map(fuel => (
                              <linearGradient key={fuel} id={`color-${fuel}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={FUEL_COLORS[fuel] || DEFAULT_COLOR} stopOpacity={0.8} />
                                <stop offset="95%" stopColor={FUEL_COLORS[fuel] || DEFAULT_COLOR} stopOpacity={0.1} />
                              </linearGradient>
                            ))}
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                          <XAxis
                            dataKey="time"
                            tickFormatter={(val) => new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            stroke="#9ca3af"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            minTickGap={30}
                          />
                          <YAxis
                            stroke="#9ca3af"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(val) => `${(val / 1000).toFixed(1)}k`}
                            label={{ value: 'MW', angle: -90, position: 'insideLeft', style: { fill: '#9ca3af' } }}
                          />
                          <Tooltip
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                            labelFormatter={(l) => new Date(l).toLocaleString()}
                            itemSorter={(a) => -(a.value as number)}
                          />
                          <Legend iconType="circle" />
                          {sortedFuels.map(fuel => (
                            <Area
                              key={fuel}
                              type="monotone"
                              dataKey={fuel}
                              stackId="1"
                              stroke={FUEL_COLORS[fuel] || DEFAULT_COLOR}
                              fill={`url(#color-${fuel})`}
                              fillOpacity={1}
                              name={fuel.charAt(0) + fuel.slice(1).toLowerCase()}
                            />
                          ))}
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground">
                        No data available
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Current Mix Pie Chart */}
              <Card className="lg:col-span-1 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PieChartIcon className="h-5 w-5 text-primary" />
                    Current Mix
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Instantaneous breakdown ({new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="h-[400px] w-full">
                    {isLoading ? (
                      <div className="flex h-full items-center justify-center">
                        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                      </div>
                    ) : pieChartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={pieChartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={80}
                            outerRadius={120}
                            paddingAngle={2}
                            dataKey="value"
                          >
                            {pieChartData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} strokeWidth={0} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                            formatter={(value: any, name: any) => [
                              `${Number(value).toLocaleString()} MW (${(Number(value) / totalCurrentGeneration * 100).toFixed(1)}%)`,
                              name
                            ]}
                          />
                          <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle">
                            <tspan x="50%" dy="-0.5em" fontSize="24" fontWeight="bold" fill="#374151">
                              {(totalCurrentGeneration / 1000).toFixed(1)}GW
                            </tspan>
                            <tspan x="50%" dy="1.5em" fontSize="14" fill="#9ca3af">
                              Total
                            </tspan>
                          </text>
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground">
                        No data available
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* System Metrics Row */}
              <div className="col-span-1 lg:col-span-3 grid gap-6 md:grid-cols-3">
                {/* System Price Card */}
                <Card className="shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base font-medium">
                      <PoundSterling className="h-4 w-4 text-primary" />
                      System Prices
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col items-center justify-center space-y-2 py-2">
                      {isLoading ? (
                        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                      ) : systemPrices !== null ? (
                        <div className="grid grid-cols-2 gap-4 w-full">
                          <div className="flex flex-col items-center col-span-2">
                            <span className="text-sm text-muted-foreground mb-0">Sell / Buy Price</span>
                            <span className={`text-4xl font-bold ${systemPrices.buy < 0 ? 'text-green-500' : systemPrices.buy > 100 ? 'text-red-500' : 'text-foreground'}`}>
                              £{systemPrices.buy.toFixed(2)}
                            </span>
                            <span className="text-xs text-muted-foreground">/ MWh</span>
                          </div>
                          <div className="col-span-2 text-center mt-1">
                            <p className="text-xs text-muted-foreground">
                              Settlement Period {lastSettlementInfo?.period} ({lastSettlementInfo?.date})
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-muted-foreground">Unavailable</p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* System Frequency Card */}
                <Card className="shadow-sm md:col-span-2">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base font-medium">
                      <Gauge className="h-4 w-4 text-primary" />
                      System Frequency
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="h-full pb-2">
                    <div className="flex items-center h-[150px]">
                      {/* Big Number */}
                      <div className="w-1/4 flex flex-col items-center justify-center border-r pr-4">
                        {isLoading ? (
                          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                        ) : currentFrequency !== null ? (
                          <>
                            <span className={`text-4xl font-bold ${Math.abs(currentFrequency - 50) > 0.2 ? 'text-red-500' : 'text-foreground'}`}>
                              {currentFrequency.toFixed(3)}
                            </span>
                            <span className="text-sm text-muted-foreground">Hz</span>
                          </>
                        ) : (
                          <p className="text-muted-foreground">Unavailable</p>
                        )}
                      </div>
                      {/* Frequency Graph */}
                      <div className="w-3/4 pl-4 h-full">
                        {frequencyData.length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={frequencyData}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                              <XAxis
                                dataKey="measurementTime"
                                hide={true}
                              />
                              <YAxis
                                domain={['dataMin - 0.05', 'dataMax + 0.05']}
                                hide={false}
                                orientation="right"
                                tick={{ fontSize: 10, fill: '#9ca3af' }}
                                axisLine={false}
                                tickLine={false}
                                tickCount={5}
                                tickFormatter={(value) => Number(value).toFixed(3)}
                              />
                              <ReferenceLine y={50.00} stroke="green" strokeDasharray="3 3" />
                              <Tooltip
                                labelFormatter={(label) => new Date(label).toLocaleTimeString()}
                                formatter={(val: any) => [`${Number(val).toFixed(3)} Hz`, 'Frequency']}
                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                              />
                              <Line
                                type="monotone"
                                dataKey="frequency"
                                stroke="#f59e0b"
                                strokeWidth={2}
                                dot={false}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                            No recent data
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Carbon Intensity Card */}
                <Card className="shadow-sm md:col-span-3">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base font-medium">
                      <Leaf className="h-4 w-4 text-primary" />
                      Carbon Intensity (gCO2/kWh)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center h-[160px]">
                      {/* Big Number */}
                      <div className="w-1/4 flex flex-col items-center justify-center border-r pr-6 relative">
                        {isLoading ? (
                          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                        ) : currentCarbon ? (
                          <div className="w-full flex flex-col items-center">
                            {(() => {
                              const val = currentCarbon.intensity.actual ?? currentCarbon.intensity.forecast ?? 0;
                              let colorClass = 'text-emerald-600';
                              let label = 'Very Low';

                              if (val >= 300) { colorClass = 'text-red-600'; label = 'Very High'; }
                              else if (val >= 200) { colorClass = 'text-orange-500'; label = 'High'; } // 200-299
                              else if (val >= 100) { colorClass = 'text-yellow-500'; label = 'Moderate'; } // 100-199
                              else if (val >= 50) { colorClass = 'text-lime-600'; label = 'Low'; } // 50-99
                              // else 0-49 Very Low

                              return (
                                <>
                                  <span className={`text-5xl font-bold tracking-tight ${colorClass}`}>
                                    {val}
                                  </span>

                                  <span className="text-sm font-medium text-muted-foreground mt-0">
                                    gCO2/kWh
                                  </span>

                                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">
                                    {label}
                                  </span>

                                  {/* Visual Slider */}
                                  <div className="w-full mt-3 px-1">
                                    {/* Custom Gradient Track matching the ranges: 0(0%)-50(12.5%)-100(25%)-200(50%)-300(75%)-400(100%) */}
                                    <div
                                      className="relative h-2 w-full rounded-full"
                                      style={{
                                        background: 'linear-gradient(to right, #10b981 0%, #65a30d 12.5%, #eab308 25%, #f97316 50%, #dc2626 75%, #7f1d1d 100%)'
                                      }}
                                    >
                                      {/* Thumb Position Calculation */}
                                      <div
                                        className="absolute top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-white border-[3px] border-slate-500 shadow-sm transition-all duration-700 ease-out box-border"
                                        ref={(el) => {
                                          if (el) {
                                            const constrained = Math.min(Math.max(val, 0), 400);
                                            const pct = (constrained / 400) * 100;
                                            el.style.left = `calc(${pct}% - 8px)`;
                                          }
                                        }}
                                      />
                                    </div>
                                    <div className="flex justify-between mt-1.5 opacity-70">
                                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">0</span>
                                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">400+</span>
                                    </div>
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        ) : (
                          <p className="text-muted-foreground">Unavailable</p>
                        )}
                      </div>
                      {/* Carbon Graph */}
                      <div className="w-3/4 pl-4 h-full">
                        {carbonData.length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={carbonData}>
                              <defs>
                                <linearGradient id="colorIndex" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                              <XAxis
                                dataKey="time"
                                tickFormatter={(val) => new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                hide={false}
                                fontSize={10}
                                stroke="#9ca3af"
                                tickLine={false}
                                axisLine={false}
                                interval={8} // Show every 4 hours approx (48 pts / 8 = 6 labels)
                              />
                              <YAxis
                                hide={false}
                                orientation="right"
                                tick={{ fontSize: 10, fill: '#9ca3af' }}
                                axisLine={false}
                                tickLine={false}
                              />
                              <Tooltip
                                labelFormatter={(label) => new Date(label).toLocaleTimeString()}
                                formatter={(val: any, name: any) => [`${val} gCO2/kWh`, name]}
                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                              />
                              <Legend iconType="circle" />
                              <Area
                                type="monotone"
                                dataKey="forecast"
                                stroke="#9ca3af"
                                strokeDasharray="5 5"
                                fill="none"
                                fillOpacity={0}
                                name="Forecast"
                              />
                              <Area
                                type="monotone"
                                dataKey="actual"
                                stroke="#10b981"
                                fill="url(#colorIndex)"
                                name="Actual"
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                            No data available
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Featured Asset (Hornsea 2) */}
          <div className="xl:col-span-1">
            <FeaturedAsset />
          </div>

        </div>
      </div>
    </div>
  );
};
