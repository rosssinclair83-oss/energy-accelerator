
export interface CarbonIntensityData {
    from: string;
    to: string;
    intensity: {
        forecast: number;
        actual: number | null;
        index: string;
    };
}

export interface CarbonIntensityResponse {
    data: CarbonIntensityData[];
}

export const fetchCurrentCarbonIntensity = async (): Promise<CarbonIntensityData | null> => {
    try {
        const response = await fetch('https://api.carbonintensity.org.uk/intensity');
        if (!response.ok) {
            console.warn('Failed to fetch current carbon intensity');
            return null;
        }
        const json: CarbonIntensityResponse = await response.json();
        return json.data.length > 0 ? json.data[0] : null;
    } catch (error) {
        console.error('Error fetching current carbon intensity:', error);
        return null;
    }
};

export const fetchDayCarbonIntensity = async (date: Date): Promise<CarbonIntensityData[]> => {
    try {
        const isoDate = date.toISOString().split('T')[0]; // YYYY-MM-DD
        const response = await fetch(`https://api.carbonintensity.org.uk/intensity/date/${isoDate}`);
        if (!response.ok) {
            console.warn('Failed to fetch day carbon intensity');
            return [];
        }
        const json: CarbonIntensityResponse = await response.json();
        return json.data;
    } catch (error) {
        console.error('Error fetching day carbon intensity:', error);
        return [];
    }
};
