
import requests
import json
from datetime import datetime, timedelta

def check_seagreen_deep():
    bmu_id = "SGRWO-1"
    now_utc = datetime.utcnow()
    # Elexon time format YYYY-MM-DD
    settlement_date = now_utc.strftime("%Y-%m-%d")
    
    print(f"Deep check for {bmu_id} around {now_utc.isoformat()}")

    # 1. MEL (Maximum Export Limit)
    # If MEL is 0, FPN is irrelevant (physically cannot generate)
    mel_url = f"https://data.elexon.co.uk/bmrs/api/v1/datasets/MEL/stream?bmUnit={bmu_id}&from={(now_utc - timedelta(hours=1)).isoformat()}&to={(now_utc + timedelta(hours=1)).isoformat()}"
    print(f"Fetching MEL...")
    try:
        mel_resp = requests.get(mel_url)
        mel_data = mel_resp.json()
        print(f"MEL records: {len(mel_data)}")
        if mel_data:
            valid_mels = [r for r in mel_data if r['timeFrom'] <= now_utc.isoformat() + "Z"]
            if valid_mels:
                print(f"Active MEL: {valid_mels[-1]['levelFrom']} MW")
    except Exception as e:
        print(f"MEL Error: {e}")

    # 2. B1610 (Actuals)
    # Try settlement date based query
    b1610_url = f"https://data.elexon.co.uk/bmrs/api/v1/datasets/B1610/stream?bmUnit={bmu_id}&settlementDate={settlement_date}"
    print(f"Fetching B1610...")
    try:
        resp = requests.get(b1610_url)
        data = resp.json()
        print(f"B1610 records for today: {len(data)}")
        if data:
            print(f"Latest B1610: {data[-1]}")
    except Exception as e:
        print(f"B1610 Error: {e}")

if __name__ == "__main__":
    check_seagreen_deep()
