export interface BmuGenerationData {
  settlementDate: string;
  settlementPeriod: number;
  timeFrom: string;
  timeTo: string;
  quantity: number;
  bmuId: string;
}

export const fetchBmuGeneration = async (
  bmuIds: string[],
  from: string,
  to: string,
  signal?: AbortSignal
): Promise<BmuGenerationData[]> => {
  try {
    // Using the stream endpoint for PN (Physical Notifications) as a proxy for real-time generation
    // https://data.elexon.co.uk/bmrs/api/v1/datasets/PN/stream
    const url = new URL('https://data.elexon.co.uk/bmrs/api/v1/datasets/PN/stream');

    url.searchParams.append('from', from);
    url.searchParams.append('to', to);

    const fetchForBmu = async (id: string) => {
      const bmuUrl = new URL(url.toString());
      bmuUrl.searchParams.append('bmUnit', id);

      const response = await fetch(bmuUrl.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal,
      });

      if (!response.ok) {
        console.warn(`[Elexon API] Failed to fetch generation for ${id}: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return Array.isArray(data) ? data.map((item: any) => ({ ...item, bmuId: id })) : [];
    };

    const results = await Promise.all(bmuIds.map(id => fetchForBmu(id)));
    const allData = results.flat();

    if (allData.length > 0) {
      // Sort by time ascending for the graph
      allData.sort((a: any, b: any) => {
        const dateA = new Date(a.timeFrom).getTime();
        const dateB = new Date(b.timeFrom).getTime();
        return dateA - dateB;
      });

      return allData.map((item: any) => ({
        settlementDate: item.settlementDate,
        settlementPeriod: item.settlementPeriod,
        timeFrom: item.timeFrom,
        timeTo: item.timeTo || item.timeFrom, // Fallback if missing
        quantity: item.levelFrom, // Use levelFrom as the generation quantity
        bmuId: item.bmuId,
      }));
    }

    return [];
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    console.error('[Elexon API] Error fetching generation data', error);
    return [];
  }
};

export interface BmuBoalData {
  settlementDate: string;
  settlementPeriod: number;
  timeFrom: string;
  timeTo: string;
  levelFrom: number;
  levelTo: number;
  bmuId: string;
}

export const fetchBmuBoal = async (
  bmuIds: string[],
  from: string,
  to: string,
  signal?: AbortSignal
): Promise<BmuBoalData[]> => {
  try {
    // Updated to use BOALF dataset as per user request
    // https://data.elexon.co.uk/bmrs/api/v1/datasets/BOALF/stream
    const url = new URL('https://data.elexon.co.uk/bmrs/api/v1/datasets/BOALF/stream');

    url.searchParams.append('from', from);
    url.searchParams.append('to', to);

    const fetchForBmu = async (id: string) => {
      const bmuUrl = new URL(url.toString());
      bmuUrl.searchParams.append('bmUnit', id);

      const response = await fetch(bmuUrl.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal,
      });

      if (!response.ok) {
        console.warn(`[Elexon API] Failed to fetch BOAL for ${id}: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return Array.isArray(data) ? data.map((item: any) => ({ ...item, bmuId: id })) : [];
    };

    const results = await Promise.all(bmuIds.map(id => fetchForBmu(id)));
    return results.flat().map((item: any) => ({
      settlementDate: item.settlementDate,
      settlementPeriod: item.settlementPeriod,
      timeFrom: item.timeFrom,
      timeTo: item.timeTo,
      levelFrom: item.levelFrom,
      levelTo: item.levelTo,
      bmuId: item.bmuId,
    }));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    console.error('[Elexon API] Error fetching BOAL data', error);
    return [];
  }
};

export interface BmuMelData {
  settlementDate: string;
  settlementPeriod: number;
  timeFrom: string;
  timeTo: string;
  levelFrom: number;
  levelTo: number;
  bmuId: string;
}

export const fetchBmuMel = async (
  bmuIds: string[],
  from: string,
  to: string,
  signal?: AbortSignal
): Promise<BmuMelData[]> => {
  try {
    const url = new URL('https://data.elexon.co.uk/bmrs/api/v1/datasets/MELS/stream');

    url.searchParams.append('from', from);
    url.searchParams.append('to', to);

    const fetchForBmu = async (id: string) => {
      const bmuUrl = new URL(url.toString());
      bmuUrl.searchParams.append('bmUnit', id);

      const response = await fetch(bmuUrl.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal,
      });

      if (!response.ok) {
        console.warn(`[Elexon API] Failed to fetch MEL for ${id}: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return Array.isArray(data) ? data.map((item: any) => ({ ...item, bmuId: id })) : [];
    };

    const results = await Promise.all(bmuIds.map(id => fetchForBmu(id)));
    return results.flat().map((item: any) => ({
      settlementDate: item.settlementDate,
      settlementPeriod: item.settlementPeriod,
      timeFrom: item.timeFrom,
      timeTo: item.timeTo,
      levelFrom: item.levelFrom,
      levelTo: item.levelTo,
      bmuId: item.bmuId,
    }));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    console.error('[Elexon API] Error fetching MEL data', error);
    return [];
  }
};

export interface BmuB1610Data {
  settlementDate: string;
  settlementPeriod: number;
  quantity: number;
  bmuId: string;
}

export const fetchBmuB1610 = async (
  bmuIds: string[],
  from: string,
  to: string,
  signal?: AbortSignal
): Promise<BmuB1610Data[]> => {
  try {
    const url = new URL('https://data.elexon.co.uk/bmrs/api/v1/datasets/B1610/stream');

    url.searchParams.append('from', from);
    url.searchParams.append('to', to);

    const fetchForBmu = async (id: string) => {
      const bmuUrl = new URL(url.toString());
      bmuUrl.searchParams.append('bmUnit', id);

      const response = await fetch(bmuUrl.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal,
      });

      if (!response.ok) {
        console.warn(`[Elexon API] Failed to fetch B1610 for ${id}: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return Array.isArray(data) ? data.map((item: any) => ({ ...item, bmuId: id })) : [];
    };

    const results = await Promise.all(bmuIds.map(id => fetchForBmu(id)));
    return results.flat().map((item: any) => ({
      settlementDate: item.settlementDate,
      settlementPeriod: item.settlementPeriod,
      // Construct a rough ISO string from settlement data if needed, or rely on API provided 'timeFrom' if available. 
      // B1610 usually provides settlementDate/Period.
      // Some endpoints provide a timestamp. Let's assume we might need to construct it or use raw props.
      // The API response usually includes power quantity.
      quantity: item.quantity,
      bmuId: item.bmuId,
    }));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    console.error('[Elexon API] Error fetching B1610 data', error);
    return [];
  }
};
export interface GenerationOutturnSummaryData {
  fuelType: string;
  generation: number;
  startTime: string;
  settlementPeriod?: number;
  percentage?: number;
}

export const fetchGenerationOutturnSummary = async (
  startTime: string,
  endTime: string,
  signal?: AbortSignal
): Promise<GenerationOutturnSummaryData[]> => {
  try {
    const url = new URL('https://data.elexon.co.uk/bmrs/api/v1/generation/outturn/summary');
    url.searchParams.append('startTime', startTime);
    url.searchParams.append('endTime', endTime);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      signal,
    });

    if (!response.ok) {
      console.warn(`[Elexon API] Failed to fetch generation summary: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    console.error('[Elexon API] Error fetching generation summary', error);
    return [];
  }
};

export interface SystemPriceData {
  settlementDate: string;
  settlementPeriod: number;
  systemSellPrice: number;
  systemBuyPrice: number;
  bsadBillableVolume: number;
}

export const fetchSystemPrice = async (
  settlementDate: string,
  signal?: AbortSignal
): Promise<SystemPriceData[]> => {
  try {
    // https://data.elexon.co.uk/bmrs/api/v1/balancing/settlement/system-prices/{settlementDate}
    const url = new URL(`https://data.elexon.co.uk/bmrs/api/v1/balancing/settlement/system-prices/${settlementDate}`);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      signal,
    });

    if (!response.ok) {
      console.warn(`[Elexon API] Failed to fetch System Price: ${response.status}`);
      return [];
    }

    const responseData = await response.json();
    let results: SystemPriceData[] = [];

    // BMRS API often wraps results in a 'data' property
    if (responseData.data && Array.isArray(responseData.data)) {
      results = responseData.data;
    } else if (Array.isArray(responseData)) {
      results = responseData;
    } else {
      results = [responseData];
    }

    // Sort descending by period so index 0 is the latest
    return results.sort((a, b) => b.settlementPeriod - a.settlementPeriod);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    console.error('[Elexon API] Error fetching system price', error);
    return [];
  }
};

export interface SystemFrequencyData {
  recordType: string;
  measurementTime: string;
  frequency: number;
}

export const fetchSystemFrequency = async (
  from: string,
  to: string,
  signal?: AbortSignal
): Promise<SystemFrequencyData[]> => {
  try {
    // https://data.elexon.co.uk/bmrs/api/v1/system/frequency/stream
    const url = new URL('https://data.elexon.co.uk/bmrs/api/v1/system/frequency/stream');
    url.searchParams.append('from', from);
    url.searchParams.append('to', to);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      signal,
    });

    if (!response.ok) {
      console.warn(`[Elexon API] Failed to fetch system frequency: ${response.status}`);
      return [];
    }

    const responseData = await response.json();
    return Array.isArray(responseData)
      ? responseData
      // If it's wrapped in { data: [...] } or distinct from array
      : responseData.data && Array.isArray(responseData.data)
        ? responseData.data
        : [];

  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    console.error('[Elexon API] Error fetching system frequency', error);
    return [];
  }
};
