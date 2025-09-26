#!/usr/bin/env bash
# IAU Constellation SVGs downloader (precise titles + rate-limit friendly)
# - Uses exact file titles on Wikimedia (avoids 404)
# - Skips existing files, retries with backoff, random waits (avoids 429)
# Usage:
#   chmod +x download_iau_svgs.sh
#   ./download_iau_svgs.sh
set -euo pipefail

OUT_DIR="public/images/constellations_iau"
mkdir -p "$OUT_DIR"

UA="IAU-Constellations-Downloader/1.1 (+contact: you@example.com)"
BASE_SLEEP="1.8"  # 필요시 3~5초로 키우면 더 안전

# --- 정확한 파일 제목 목록 (Wikimedia "File:<Title>.svg")
#    ※ 일부는 분음기호(Boötes) 포함, Serpens는 Caput/Cauda로 분리되어 있음.
TITLES=(
"Andromeda IAU.svg" "Antlia IAU.svg" "Apus IAU.svg" "Aquarius IAU.svg" "Aquila IAU.svg"
"Ara IAU.svg" "Aries IAU.svg" "Auriga IAU.svg" "Boötes IAU.svg" "Caelum IAU.svg"
"Camelopardalis IAU.svg" "Cancer IAU.svg" "Canes Venatici IAU.svg" "Canis Major IAU.svg"
"Canis Minor IAU.svg" "Capricornus IAU.svg" "Carina IAU.svg" "Cassiopeia IAU.svg"
"Centaurus IAU.svg" "Cepheus IAU.svg" "Cetus IAU.svg" "Chamaeleon IAU.svg" "Circinus IAU.svg"
"Columba IAU.svg" "Coma Berenices IAU.svg" "Corona Australis IAU.svg" "Corona Borealis IAU.svg"
"Corvus IAU.svg" "Crater IAU.svg" "Crux IAU.svg" "Cygnus IAU.svg" "Delphinus IAU.svg"
"Dorado IAU.svg" "Draco IAU.svg" "Equuleus IAU.svg" "Eridanus IAU.svg" "Fornax IAU.svg"
"Gemini IAU.svg" "Grus IAU.svg" "Hercules IAU.svg" "Horologium IAU.svg" "Hydra IAU.svg"
"Hydrus IAU.svg" "Indus IAU.svg" "Lacerta IAU.svg" "Leo IAU.svg" "Leo Minor IAU.svg"
"Lepus IAU.svg" "Libra IAU.svg" "Lupus IAU.svg" "Lynx IAU.svg" "Lyra IAU.svg" "Mensa IAU.svg"
"Microscopium IAU.svg" "Monoceros IAU.svg" "Musca IAU.svg" "Norma IAU.svg" "Octans IAU.svg"
"Ophiuchus IAU.svg" "Orion IAU.svg" "Pavo IAU.svg" "Pegasus IAU.svg" "Perseus IAU.svg"
"Phoenix IAU.svg" "Pictor IAU.svg" "Pisces IAU.svg" "Piscis Austrinus IAU.svg" "Puppis IAU.svg"
"Pyxis IAU.svg" "Reticulum IAU.svg" "Sagitta IAU.svg" "Sagittarius IAU.svg" "Scorpius IAU.svg"
"Sculptor IAU.svg" "Scutum IAU.svg"
# Serpens은 Caput/Cauda 두 파일로 존재
"Serpens Caput IAU.svg" "Serpens Cauda IAU.svg"
"Sextans IAU.svg" "Taurus IAU.svg" "Telescopium IAU.svg" "Triangulum IAU.svg"
"Triangulum Australe IAU.svg" "Tucana IAU.svg" "Ursa Major IAU.svg" "Ursa Minor IAU.svg"
"Vela IAU.svg" "Virgo IAU.svg" "Volans IAU.svg" "Vulpecula IAU.svg"
)

# 파일명 → 슬러그(소문자+언더스코어) 변환 (저장 이름 통일)
slugify () {
  echo "$1" \
    | sed 's/ IAU\.svg$//' \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/ /_/g' \
    | sed 's/ö/oe/g'  # 파일 저장명에서 ö → oe (bootes.svg 로 정규화)
}

download_one () {
  local TITLE="$1"                     # ex) "Boötes IAU.svg"
  local NAME="${TITLE% IAU.svg}"       # ex) "Boötes"
  local SLUG="$(slugify "$TITLE")"     # ex) "bootes"
  local OUT="$OUT_DIR/${SLUG}.svg"
  local URL="https://commons.wikimedia.org/wiki/Special:FilePath/${TITLE// /%20}"
  local TMP="$OUT.download"

  if [[ -f "$OUT" ]]; then
    echo "Skip (exists): $OUT"
    return 0
  fi

  echo "Downloading: $TITLE -> $OUT"
  local attempt=0 max_attempts=8 sleep_s="$BASE_SLEEP"
  while (( attempt < max_attempts )); do
    attempt=$((attempt+1))
    if curl -A "$UA" -L --fail --silent --show-error "$URL" -o "$TMP"; then
      mv "$TMP" "$OUT"
      echo "OK: $OUT"
      # 요청 간 랜덤 대기
      awk -v base="$BASE_SLEEP" 'BEGIN{srand(); r=base+(rand()*1.0); printf "sleep %.2f\n", r}' | bash
      return 0
    else
      echo "  -> retry $attempt/$max_attempts after ${sleep_s}s"
      sleep "$sleep_s"
      sleep_s=$(awk -v s="$sleep_s" 'BEGIN{n=s*1.7; if(n>60)n=60; printf "%.2f\n", n}')
    fi
  done
  echo "FAIL: $TITLE ($URL)"
  return 1
}

FAILED=()
for T in "${TITLES[@]}"; do
  if ! download_one "$T"; then
    FAILED+=("$T")
  fi
done

# 느린 재시도
if (( ${#FAILED[@]} > 0 )); then
  echo
  echo "### RETRY PASS (slow) ###"
  BASE_SLEEP="3.5"
  AGAIN=()
  for T in "${FAILED[@]}"; do
    if ! download_one "$T"; then
      AGAIN+=("$T")
    fi
  done
  FAILED=("${AGAIN[@]}")
fi

echo
if (( ${#FAILED[@]} > 0 )); then
  echo "Still failed (${#FAILED[@]}):"
  printf ' - %s\n' "${FAILED[@]}"
  echo "→ 잠시 후 다시 실행하거나 BASE_SLEEP 값을 더 키워 다시 실행하세요."
  exit 2
else
  echo "All done. Files in $OUT_DIR"
fi
