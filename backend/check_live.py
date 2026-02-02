
import requests
import json
from datetime import datetime, timedelta

def check_live_position():
    bmu_id = "MOWEO-1"
    now_utc = datetime.utcnow()
    # Check a small window around NOW to see active BOAs
    from_time = (now_utc - timedelta(minutes=30)).isoformat()
    to_time = (now_utc + timedelta(minutes=30)).isoformat()
    
    print(f"Checking data for {bmu_id} around {now_utc.isoformat()}")
    
    # 1. Fetch PN (Planned)
    pn_url = f"https://data.elexon.co.uk/bmrs/api/v1/datasets/PN/stream?bmUnit={bmu_id}&from={from_time}&to={to_time}"
    pn_resp = requests.get(pn_url)
    pn_val = "N/A"
    
    if pn_resp.status_code == 200:
        data = pn_resp.json()
        # Find record covering NOW
        # PN records have timeFrom
        # We want the record where timeFrom <= NOW < timeTo? 
        # Actually PN stream is often just timeFrom points.
        # "levelFrom" applied from "timeFrom".
        
        valid_pns = [r for r in data if r['timeFrom'] <= now_utc.isoformat() + "Z"]
        if valid_pns:
            valid_pns.sort(key=lambda x: x['timeFrom'])
            last_pn = valid_pns[-1]
            pn_val = last_pn['levelFrom']
            print(f"Latest FPN: {pn_val} MW (at {last_pn['timeFrom']})")
        else:
            print("No past PN found in window")
    else:
        print("Failed to fetch PN")

    # 2. Fetch BOAL (Bid Offer Acceptances)
    boal_url = f"https://data.elexon.co.uk/bmrs/api/v1/datasets/BOAL/stream?bmUnit={bmu_id}&from={from_time}&to={to_time}"
    boal_resp = requests.get(boal_url)
    
    if boal_resp.status_code == 200:
        data = boal_resp.json()
        print(f"Found {len(data)} BOAL records in window")
        for rec in data:
            print(f"BOA: {rec['timeFrom']} -> {rec['timeTo']} | Level: {rec['levelFrom']} -> {rec['levelTo']}")
    else:
        print("Failed to fetch BOAL")

if __name__ == "__main__":
    check_live_position()
