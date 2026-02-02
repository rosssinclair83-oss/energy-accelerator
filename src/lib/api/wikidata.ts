const WIKIDATA_ID_PATTERN = /\bQ\d+\b/i;
const WIKIDATA_PROPERTY_KEYS = [
  'wikidata',
  'wikidata:id',
  'ref:wikidata',
  'wikidata_ref',
  'wikidata_id',
  'wd:id',
] as const;

// Simple in-memory cache for Wikidata data
const wikidataCache = new Map<string, { imageUrl: string | null; bmuIds: string[] } | null>();

type WikidataClaim = {
  mainsnak?: {
    datavalue?: { value?: unknown };
  };
};

const normaliseWikidataId = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const match = value.match(WIKIDATA_ID_PATTERN);
  return match ? match[0].toUpperCase() : undefined;
};

export const extractWikidataId = (properties: Record<string, unknown>): string | undefined => {
  for (const key of WIKIDATA_PROPERTY_KEYS) {
    const candidate = normaliseWikidataId(properties[key]);
    if (candidate) {
      return candidate;
    }
  }

  for (const key of Object.keys(properties)) {
    if (!key.toLowerCase().includes('wikidata')) {
      continue;
    }

    const candidate = normaliseWikidataId(properties[key]);
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
};

export const fetchWikidataData = async (
  wikidataId: string,
  signal?: AbortSignal,
): Promise<{ imageUrl: string | null; bmuIds: string[] } | null> => {
  // Check cache first
  if (wikidataCache.has(wikidataId)) {
    return wikidataCache.get(wikidataId) ?? null;
  }

  try {
    const entityResponse = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(
        wikidataId,
      )}&format=json&props=claims&origin=*`,
      { signal },
    );

    if (!entityResponse.ok) {
      console.warn('[Wikidata API] entity request failed', wikidataId, entityResponse.status);
      return null;
    }

    const entityData = (await entityResponse.json()) as {
      entities?: Record<string, { claims?: Record<string, unknown> }>;
    };

    const entity = entityData.entities?.[wikidataId] ?? Object.values(entityData.entities ?? {})[0];

    const claims = (entity as { claims?: Record<string, unknown> } | undefined)?.claims;

    // Extract BMU IDs (P11610)
    const rawP11610 = claims?.['P11610'];
    const p11610Claims = Array.isArray(rawP11610) ? (rawP11610 as WikidataClaim[]) : undefined;

    const bmuIds: string[] = [];
    if (p11610Claims) {
      for (const claim of p11610Claims) {
        const val = claim.mainsnak?.datavalue?.value;
        if (typeof val === 'string' && val.trim()) {
          bmuIds.push(val.trim());
        }
      }
    }

    // Extract Image (P18)
    const rawP18 = claims?.['P18'];
    const p18Claims = Array.isArray(rawP18) ? (rawP18 as WikidataClaim[]) : undefined;
    const imageClaim = p18Claims?.[0];
    const fileName = imageClaim?.mainsnak?.datavalue?.value;

    if (typeof fileName !== 'string' || !fileName.trim()) {
      const result = { imageUrl: null, bmuIds };
      wikidataCache.set(wikidataId, result);
      return result;
    }

    const normalisedFileName = fileName.replace(/\s/g, '_');

    const commonsResponse = await fetch(
      `https://commons.wikimedia.org/w/api.php?action=query&format=json&titles=File:${encodeURIComponent(
        normalisedFileName,
      )}&prop=imageinfo&iiprop=url&iiurlwidth=800&origin=*`,
      { signal },
    );

    if (!commonsResponse.ok) {
      console.warn(
        '[Wikidata API] commons image request failed',
        wikidataId,
        commonsResponse.status,
      );
      return null;
    }

    const commonsData = (await commonsResponse.json()) as {
      query?: {
        pages?: Record<string, { imageinfo?: Array<{ url?: string; thumburl?: string }> }>;
      };
    };

    const pages = commonsData.query?.pages;
    if (!pages) {
      const result = { imageUrl: null, bmuIds };
      wikidataCache.set(wikidataId, result);
      return result;
    }

    const page = Object.values(pages)[0];
    const imageInfo = page?.imageinfo?.[0];
    const imageUrl = imageInfo?.thumburl ?? imageInfo?.url;
    const finalImageUrl = typeof imageUrl === 'string' ? imageUrl : null;

    const result = { imageUrl: finalImageUrl, bmuIds };
    wikidataCache.set(wikidataId, result);
    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }

    console.warn('[Wikidata API] failed to fetch image', wikidataId, error);
    return null;
  }
};

export const getCachedWikidataData = (
  wikidataId: string,
): { imageUrl: string | null; bmuIds: string[] } | null | undefined => {
  return wikidataCache.get(wikidataId);
};
