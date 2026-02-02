
import requests
import json
from datetime import datetime, timedelta

def check_seagreen_live():
    # SGRWO-1 is one of the units
    bmu_id = "SGRWO-1"
    
    # We want "now" but maybe slightly in the past to ensure data is published
    # Elexon Realtime is usually near-instant but let's check the last 30 mins
    now_utc = datetime.utcnow()
    from_time = (now_utc - timedelta(hours=24)).isoformat()
    to_time = (now_utc + timedelta(hours=1)).isoformat()
    
    print(f"Checking data for {bmu_id} at {now_utc.isoformat()}")
    print(f"Window: {from_time} to {to_time}")
    
    # 1. Fetch PN (Planned)
    pn_url = f"https://data.elexon.co.uk/bmrs/api/v1/datasets/PN/stream?bmUnit={bmu_id}&from={from_time}&to={to_time}"
    print("Fetching PN...")
    pn_resp = requests.get(pn_url)
    current_pn = None
    
    if pn_resp.status_code == 200:
        data = pn_resp.json()
        print(f"Got {len(data)} PN records")
        # Print all to debug
        for r in data:
            print(f"Rec: {r['timeFrom']} -> {r.get('timeTo', '?')} | Level: {r['levelFrom']} -> {r['levelTo']}")

        # Validate against NOW
        future_recs = [r for r in data if r['timeFrom'] > now_utc.isoformat() + "Z"]
        if future_recs:
            print("WARNING: Found future records!")
        
        # Find active PN
        valid_pns = [r for r in data if r['timeFrom'] <= now_utc.isoformat() + "Z"]
        if valid_pns:
            valid_pns.sort(key=lambda x: x['timeFrom'])
            current_pn_rec = valid_pns[-1]
            current_pn = current_pn_rec['levelFrom']
            print(f"Active PN Level: {current_pn} MW (from {current_pn_rec['timeFrom']})")
        else:
            print("No active PN found")
    
    # 2. Fetch BOAL (Acceptances)
    boal_url = f"https://data.elexon.co.uk/bmrs/api/v1/datasets/BOAL/stream?bmUnit={bmu_id}&from={from_time}&to={to_time}"
    print("Fetching BOAL...")
    boal_resp = requests.get(boal_url)
    current_boa = None
    
    if boal_resp.status_code == 200:
        data = boal_resp.json()
        print(f"Got {len(data)} BOAL records")
        # BOAL records have timeFrom and timeTo.
        # Find if any interval overlaps NOW.
        # BOALs can overlap? Usually distinct instructions per Bid-Offer Pair but we care about the composite.
        # Actually in the BOAL stream, Elexon usually presents the consolidated acceptance volume?
        # Or individual acceptances.
        # However, if there is a BOA active, it overrides PN.
        
        active_boas = []
        for rec in data:
            # Check overlap
            t_start = rec['timeFrom']
            t_end = rec['timeTo'] # may not exist? BOAL usually has duration via pairs.
            # stream endpoint returns timeFrom, timeTo
            
            if t_start <= now_utc.isoformat() + "Z" and rec['timeTo'] >= now_utc.isoformat() + "Z":
                active_boas.append(rec)
                print(f"ACTIVE BOA: {rec['timeFrom']} -> {rec['timeTo']} | Level: {rec['levelFrom']} -> {rec['levelTo']}")
        
        if active_boas:
            # If multiple, logic is complex (stacking), but usually for offshore wind curtailment there's one dominant 'bid' bringing it to 0.
            # Let's see the level.
            # Just take the last one or average?
            last_boa = active_boas[-1]
            current_boa = last_boa['levelFrom'] # varied across time, simplified check
            print(f"Current BOA Level appears to be ~{current_boa}")
            
    # Conclusion
    print("\n--- SUMMARY ---")
    print(f"Calculated PN (Planned): {current_pn}")
    print(f"Calculated BOA (Override): {current_boa}")
    final_output = current_boa if current_boa is not None else current_pn
    print(f"Likely Actual Output: {final_output}")

if __name__ == "__main__":
    check_seagreen_live()
