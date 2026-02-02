
import requests
import json
from datetime import datetime, timedelta

def check_structure():
    bmu_id = "SGRWO-1"
    now_utc = datetime.utcnow()
    
    # Check MEL
    mel_url = f"https://data.elexon.co.uk/bmrs/api/v1/datasets/MEL/stream?bmUnit={bmu_id}&from={(now_utc - timedelta(hours=1)).isoformat()}&to={(now_utc + timedelta(hours=1)).isoformat()}"
    print("--- MEL RAW ---")
    try:
        r = requests.get(mel_url)
        print(json.dumps(r.json(), indent=2))
    except:
        print("Failed MEL")

    # Check B1610
    settlement_date = now_utc.strftime("%Y-%m-%d")
    b1610_url = f"https://data.elexon.co.uk/bmrs/api/v1/datasets/B1610/stream?bmUnit={bmu_id}&from={(now_utc - timedelta(hours=4)).isoformat()}&to={now_utc.isoformat()}"
    # Using stream for B1610 to ensure we get a list
    print("\n--- B1610 RAW ---")
    try:
        r = requests.get(b1610_url)
        print(json.dumps(r.json(), indent=2))
    except:
        print("Failed B1610")

if __name__ == "__main__":
    check_structure()
