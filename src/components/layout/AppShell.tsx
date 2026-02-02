import { useState, useEffect } from 'react';
import { CircleUser, Layers, Menu, Plus, X, Check, ChevronDown, ChevronRight, Search, Zap } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { cn } from '@/lib/utils';
import { Input } from '@/components/common/input';
import { Button } from '@/components/common/button';
import { useAppStore, type LayerGroupId } from '@/state/store';

import plantsImage from '@/assets/tile-images/plants.png';
import generatorsImage from '@/assets/tile-images/generators.png';
import substationsImage from '@/assets/tile-images/substations.png';
import transmissionImage from '@/assets/tile-images/transmission.png';
import cablesImage from '@/assets/tile-images/cables.png';
import distributionImage from '@/assets/tile-images/distribution.png';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/map', label: 'Map' },
  { to: '/analysis', label: 'Analysis' },
];

type PowerInfrastructureTile = {
  id: string;
  group: LayerGroupId;
  title: string;
  source: string;
  description: string;
  image: string;
};

const POWER_INFRASTRUCTURE: PowerInfrastructureTile[] = [
  {
    id: 'plants',
    group: 'powerPlants',
    title: 'Power Plants',
    source: 'OpenStreetMap',
    description:
      'Portfolio of UK power plants covering wind, solar, nuclear and conventional stations, enriched with installed capacity, REPD identifiers, BMU codes and operator metadata.',
    image: plantsImage,
  },
  {
    id: 'generators',
    group: 'powerGenerators',
    title: 'Power Generators',
    source: 'OpenStreetMap',
    description:
      'Catalog of UK generation assets spanning onshore/offshore wind, solar farms, hydro and biomass sites, including nameplate output, technology type, commissioning date and operator metadata.',
    image: generatorsImage,
  },
  {
    id: 'substations',
    group: 'substations',
    title: 'Substations',
    source: 'OpenStreetMap',
    description:
      'Network of primary and grid substations, mapped with voltage levels, ownership, connected circuits and georeferenced footprints for grid planning.',
    image: substationsImage,
  },
  {
    id: 'lines',
    group: 'transmission',
    title: 'Transmission Lines',
    source: 'OpenStreetMap',
    description:
      'Overhead high-voltage corridors (>=132 kV) traced with conductor bundle info, tower geometry, circuit identifiers and thermal ratings.',
    image: transmissionImage,
  },
  {
    id: 'cables',
    group: 'cables',
    title: 'Cables',
    source: 'OpenStreetMap',
    description:
      'Underground and subsea transmission cables showing voltage class, insulation type, burial status, circuit pairing and associated landing points.',
    image: cablesImage,
  },
  {
    id: 'minor_lines',
    group: 'distribution',
    title: 'Distribution Lines',
    source: 'OpenStreetMap',
    description:
      'Medium- and low-voltage feeders (66 kV and below) covering urban and rural networks with phase configuration, conductor material and service area overlays.',
    image: distributionImage,
  },
];

const AppShell = () => {
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
  const location = useLocation();
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddLayerPanel, setShowAddLayerPanel] = useState(false);
  const groupVisibility = useAppStore((state) => state.groupVisibility);
  const setLayerGroupVisibility = useAppStore((state) => state.setLayerGroupVisibility);
  const setSelectedSearchResult = useAppStore((state) => state.setSelectedSearchResult);

  // Search State
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [allSearchData, setAllSearchData] = useState<any[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSearchLoading, setIsSearchLoading] = useState(false);

  // Load Search Index
  useEffect(() => {
    setIsSearchLoading(true);
    const envBaseUrl = import.meta.env.VITE_DATA_BASE_URL || '';
    const baseUrl = envBaseUrl.endsWith('/') ? envBaseUrl.slice(0, -1) : envBaseUrl;
    fetch(`${baseUrl}/power_search_index.json`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setAllSearchData(data);
        }
      })
      .catch(err => console.error('Failed to load search index', err))
      .finally(() => setIsSearchLoading(false));
  }, []);

  // Filter Logic
  useEffect(() => {
    if (searchTerm.trim().length < 2) {
      setSearchResults([]);
      setIsSearchOpen(false);
      return;
    }
    const lowerQ = searchTerm.toLowerCase();
    const filtered = allSearchData
      .filter(item => item.name.toLowerCase().includes(lowerQ))
      .sort((a, b) => (b.capacity || 0) - (a.capacity || 0)) // Sort by Capacity Descending
      .slice(0, 10);
    setSearchResults(filtered);
    setIsSearchOpen(filtered.length > 0);
  }, [searchTerm, allSearchData]);

  const handleSearchResultSelect = (result: any) => {
    setSelectedSearchResult(result);
    setSearchTerm(''); // Clear input to reset
    setSearchResults([]); // Clear results
    setIsSearchOpen(false); // Close dropdown
  };

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);
  const toggleAddLayerPanel = () => setShowAddLayerPanel((prev) => !prev);
  const toggleSourceSelection = (group: LayerGroupId) => {
    const selectableGroups: LayerGroupId[] = [
      'powerPlants',
      'powerGenerators',
      'substations',
      'transmission',
      'cables',
      'distribution',
    ];
    if (!selectableGroups.includes(group)) {
      return;
    }

    const current = groupVisibility[group];
    setLayerGroupVisibility(group, !current);
  };

  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({
    OpenStreetMap: true,
  });

  const toggleSource = (source: string) => {
    setExpandedSources((prev) => ({
      ...prev,
      [source]: !prev[source],
    }));
  };

  const activeLayersBySource = POWER_INFRASTRUCTURE.reduce(
    (acc, item) => {
      if (!groupVisibility[item.group]) return acc;
      if (!acc[item.source]) {
        acc[item.source] = [];
      }
      acc[item.source].push(item);
      return acc;
    },
    {} as Record<string, typeof POWER_INFRASTRUCTURE>,
  );

  const hasActiveLayers = Object.keys(activeLayersBySource).length > 0;

  return (
    <div className="relative min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      <div className="absolute inset-0 z-0">
        <Outlet />
      </div>

      <header className="absolute left-0 right-0 top-0 z-40 border-b border-border/60 bg-card/90 backdrop-blur">
        <div className="flex items-center justify-between gap-6 px-6 py-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label={sidebarOpen ? 'Hide data panel' : 'Show data panel'}
              aria-expanded={sidebarOpen}
              onClick={toggleSidebar}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <span className="text-lg font-semibold tracking-tight">Energy Accelerator</span>
            <nav className="ml-6 hidden items-center gap-1 md:flex">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-sm'
                        : 'text-[hsl(var(--foreground))]/80 hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]',
                    )
                  }
                  end={item.to === '/map'}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-3 lg:flex relative group">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onFocus={() => {
                    if (searchResults.length > 0) setIsSearchOpen(true);
                  }}
                  placeholder="Search power plants..."
                  className="w-72 pl-9"
                />
                {isSearchLoading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="h-3 w-3 border-2 border-slate-200 border-t-slate-400 rounded-full animate-spin" />
                  </div>
                )}
              </div>

              {/* Search Results Dropdown */}
              {isSearchOpen && searchResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-popover text-popover-foreground rounded-md border shadow-md z-50 overflow-hidden">
                  <div className="max-h-[300px] overflow-y-auto py-1">
                    {searchResults.map(result => (
                      <button
                        key={result.id}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50 text-left transition-colors"
                        onClick={() => handleSearchResultSelect(result)}
                      >
                        <div className={cn("h-6 w-6 rounded flex items-center justify-center flex-shrink-0 bg-slate-100 dark:bg-slate-800")}>
                          <Zap className="h-3 w-3 text-slate-500" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{result.name}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-2">
                            <span className="capitalize">{result.technology_type?.replace(/_/g, ' ') || result.asset_type}</span>
                            {result.capacity && <span>• {Math.round(result.capacity)} MW</span>}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Overlay to close search when clicking outside */}
              {isSearchOpen && (
                <div
                  className="fixed inset-0 z-40 bg-transparent"
                  onClick={() => setIsSearchOpen(false)}
                />
              )}
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-border/70 bg-background text-muted-foreground">
              <CircleUser className="h-5 w-5" aria-hidden="true" />
            </div>
          </div>
        </div>
      </header>

      {location.pathname === '/map' && (
        <aside className="absolute inset-y-0 left-0 z-30 mt-16 flex items-start">
          <div className="relative z-10 flex h-full w-10 flex-col items-center border-r border-border/60 bg-card py-4 shadow-md">
            <button
              type="button"
              className={cn(
                'inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors focus:outline-none focus-visible:ring focus-visible:ring-[hsl(var(--primary))]/40',
                sidebarOpen
                  ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                  : 'hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]',
              )}
              aria-label={sidebarOpen ? 'Hide data panel' : 'Show data panel'}
              aria-pressed={sidebarOpen}
              onClick={toggleSidebar}
            >
              <Layers className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <div
            className={cn(
              'relative z-0 pointer-events-none h-full w-[300px] border-r border-border/60 bg-card/95 shadow-xl transition-transform duration-200 ease-out',
              sidebarOpen ? 'pointer-events-auto translate-x-0' : '-translate-x-full',
            )}
          >
            <div className="mt-0 flex h-full flex-col">
              <div className="border-b border-border/50 px-6 py-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Map Layers
                </h2>
                <div className="mt-4 flex items-center gap-2">
                  <Input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search map layers"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="default"
                    size="icon"
                    onClick={toggleAddLayerPanel}
                    title="Add Data Sources"
                  >
                    <span className="sr-only">Add Data Sources</span>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4">
                <div className="space-y-4">
                  {Object.entries(activeLayersBySource).map(([source, items]) => (
                    <div key={source} className="space-y-1">
                      <button
                        onClick={() => toggleSource(source)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-foreground hover:bg-muted/50"
                      >
                        {expandedSources[source] ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="truncate">{source}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{items.length}</span>
                      </button>

                      {expandedSources[source] && (
                        <div className="ml-2 space-y-1 border-l border-border/40 pl-2">
                          {items.map((item) => (
                            <div
                              key={item.id}
                              className="group relative flex items-center gap-3 rounded-md border border-transparent px-2 py-1.5 transition-colors hover:bg-muted/40"
                            >
                              <div className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded border border-border/20">
                                <img src={item.image} alt="" className="h-full w-full object-cover" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <h4 className="truncate text-sm font-medium text-foreground/90">
                                  {item.title}
                                </h4>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => setLayerGroupVisibility(item.group, false)}
                                title={`Remove ${item.title}`}
                              >
                                <span className="sr-only">Remove {item.title}</span>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}

                  {!hasActiveLayers && (
                    <div className="rounded-md border border-dashed border-border/60 bg-background/70 px-4 py-6 text-center text-sm text-muted-foreground">
                      No active data layers. Click + to add some.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </aside>
      )}
      {showAddLayerPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div
            className="relative flex w-full max-w-[1500px] flex-col rounded-2xl border border-border bg-card shadow-2xl"
            style={{ width: 'min(90vw, 1500px)', height: 'min(90vh, 800px)' }}
          >
            <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
              <h3 className="text-lg font-semibold text-foreground">Data Sources</h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleAddLayerPanel}
                aria-label="Close data sources window"
              >
                <span className="sr-only">Close data sources window</span>
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto px-8 py-6">
              <section className="space-y-6">
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Power Infrastructure
                  </h4>
                </div>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {POWER_INFRASTRUCTURE.map((item) => {
                    const isAdded = groupVisibility[item.group];
                    const isSelectable = [
                      'powerPlants',
                      'powerGenerators',
                      'substations',
                      'transmission',
                      'cables',
                      'distribution',
                    ].includes(item.group);
                    const actionLabel = isAdded ? 'Remove' : 'Add';
                    const srLabel = isSelectable
                      ? `${actionLabel} ${item.title}`
                      : `${item.title} selection coming soon`;

                    return (
                      <article
                        key={item.id}
                        className="group relative flex flex-col overflow-hidden rounded-[32px] border border-border/60 bg-background/95 shadow-sm transition-shadow duration-200 hover:shadow-xl"
                      >
                        <div className="relative h-44 overflow-hidden">
                          <img
                            src={item.image}
                            alt={`${item.title} illustrative graphic`}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                          <div
                            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent"
                            aria-hidden="true"
                          />
                          <button
                            type="button"
                            onClick={
                              isSelectable ? () => toggleSourceSelection(item.group) : undefined
                            }
                            aria-pressed={isSelectable ? isAdded : undefined}
                            aria-label={srLabel}
                            title={isSelectable ? srLabel : 'Selection coming soon'}
                            disabled={!isSelectable}
                            className={cn(
                              'absolute right-5 top-5 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-border/60 bg-white/90 text-muted-foreground transition-colors duration-200 group-hover:border-[hsl(var(--primary))]/50',
                              isAdded &&
                              'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
                              !isSelectable && 'cursor-not-allowed opacity-60',
                            )}
                          >
                            {isAdded ? (
                              <Check className="h-5 w-5" aria-hidden="true" />
                            ) : (
                              <Plus className="h-5 w-5" aria-hidden="true" />
                            )}
                            <span className="sr-only">{srLabel}</span>
                          </button>
                        </div>
                        <div className="flex flex-1 flex-col justify-between bg-muted/40 px-6 py-5">
                          <div className="space-y-1.5">
                            <div className="flex items-baseline justify-between gap-3">
                              <h5 className="text-lg font-semibold text-foreground">
                                {item.title}
                              </h5>
                              <span className="text-[0.65rem] font-medium uppercase text-muted-foreground">
                                {item.source}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground">{item.description}</p>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AppShell;
