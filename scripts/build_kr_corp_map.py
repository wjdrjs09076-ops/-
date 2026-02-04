# scripts/build_kr_corp_map.py
import io
import json
import os
import zipfile
import xml.etree.ElementTree as ET
from urllib.request import urlopen

DART_CORP_CODE_URL = "https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key={key}"

def main():
    api_key = os.environ.get("DART_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("Missing env DART_API_KEY")

    url = DART_CORP_CODE_URL.format(key=api_key)

    # 1) download zip(binary)
    with urlopen(url) as resp:
        data = resp.read()

    # 2) unzip -> CORPCODE.xml
    zf = zipfile.ZipFile(io.BytesIO(data))
    # 파일명은 보통 CORPCODE.xml
    xml_name = None
    for name in zf.namelist():
        if name.lower().endswith(".xml"):
            xml_name = name
            break
    if not xml_name:
        raise SystemExit("No XML found inside zip")

    xml_bytes = zf.read(xml_name)

    # 3) parse xml
    root = ET.fromstring(xml_bytes)

    # XML 구조: <result><list>...</list><list>...</list>...
    out = {}
    for item in root.findall(".//list"):
        corp_code = (item.findtext("corp_code") or "").strip()
        corp_name = (item.findtext("corp_name") or "").strip()
        stock_code = (item.findtext("stock_code") or "").strip()
        # 상장사만: stock_code 있는 것만
        if len(stock_code) != 6 or len(corp_code) != 8:
            continue
        out[stock_code] = {"corp_code": corp_code, "name": corp_name}

    # 4) write to docs/kr_corp_map.json
    os.makedirs("docs", exist_ok=True)
    with open("docs/kr_corp_map.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2, sort_keys=True)

    print(f"✅ wrote docs/kr_corp_map.json with {len(out):,} tickers")

if __name__ == "__main__":
    main()
