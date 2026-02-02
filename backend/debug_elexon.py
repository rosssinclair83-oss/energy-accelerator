
import requests
import json
from datetime import datetime, timedelta

def get_pn_data(bmu_id):
    # Construct time range for last 24 hours
    now = datetime.utcnow()
    to_time = now.isoformat()
    from_time = (now - timedelta(hours=24)).isoformat()
    
    url = f"https://data.elexon.co.uk/bmrs/api/v1/datasets/PN/stream?bmUnit={bmu_id}&from={from_time}&to={to_time}"
    print(f"Fetching PN from: {url}")
    
    try:
        resp = requests.get(url)
        if resp.status_code == 200:
            data = resp.json()
            return data
        else:
            print(f"PN Error: {resp.status_code} {resp.text}")
            return []
    except Exception as e:
        print(f"PN Exception: {e}")
        return []

def get_b1610_data(bmu_id):
    # Actual Generation Output
    # Endpoint might be /datasets/B1610/stream
    # Or /datasets/actual-generation/stream ? 
    # Let's try the generation-outage/availability or just standard B1610 if available in API v1
    # Often it is under 'generation'
    
    # Looking at Elexon API docs (mental check), B1610 is 'actual-generation-per-unit' usually.
    # https://data.elexon.co.uk/bmrs/api/v1/datasets/B1610/stream?
    
    # Let's try to query B1610
    now = datetime.utcnow()
    to_time = now.isoformat()
    from_time = (now - timedelta(hours=24)).isoformat()

    url = f"https://data.elexon.co.uk/bmrs/api/v1/datasets/B1610/stream?bmUnit={bmu_id}&settlementDateFrom={from_time[:10]}&settlementDateTo={to_time[:10]}"
    # B1610 often takes settlementDate, but let's try the stream endpoint if it exists or fall back to standard params.
    # The 'stream' endpoint usually accepts 'from' and 'to' strings.
    
    url = f"https://data.elexon.co.uk/bmrs/api/v1/datasets/B1610/stream?bmUnit={bmu_id}&from={from_time}&to={to_time}"
    
    print(f"Fetching B1610 from: {url}")
    
    try:
        resp = requests.get(url)
        if resp.status_code == 200:
            data = resp.json()
            return data
        else:
            print(f"B1610 Error: {resp.status_code} {resp.text}")
            return []
    except Exception as e:
        print(f"B1610 Exception: {e}")
        return []

def main():
    bmu_id = "MOWEO-1"
    
    print(f"--- CHECKING PN DATA for {bmu_id} ---")
    pn_data = get_pn_data(bmu_id)
    print(f"Got {len(pn_data)} PN records")
    
    if pn_data:
        # Sort by timeFrom
        pn_data.sort(key=lambda x: x.get('timeFrom'))
        
        # Check for current time
        now_utc = datetime.utcnow()
        print(f"Current UTC Time: {now_utc.isoformat()}")
        
        current_rec = None
        for i, rec in enumerate(pn_data):
            tf = datetime.fromisoformat(rec['timeFrom'].replace('Z', '+00:00')).replace(tzinfo=None)
            # The API returns timeFrom. PN records are point-in-time or periods?
            # PN stream usually returns levels at specific times.
            # actually Elexon PN stream returns 'timeFrom' and 'levelFrom', 'levelTo'.
            # It seems to be a sequence of steps.
            pass

        # Print the last 5 records
        print("\nLast 5 Records:")
        for rec in pn_data[-5:]:
            print(f"Time: {rec['timeFrom']} | Level: {rec['levelFrom']} -> {rec['levelTo']}")

        # Find the record that is closest to NOW
        # If PN is a series of steps, we look for timeFrom <= now.
        valid_recs = [r for r in pn_data if r['timeFrom'] <= now_utc.isoformat() + "Z"]
        if valid_recs:
            latest_valid = valid_recs[-1]
            print(f"\nLatest PAST record (closest to now):")
            print(f"Time: {latest_valid['timeFrom']} | Level: {latest_valid['levelFrom']}")
            print(f"Raw: {json.dumps(latest_valid)}")
        else:
            print("No records found in the past 24h?")

if __name__ == "__main__":
    main()
