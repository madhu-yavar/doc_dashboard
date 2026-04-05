#!/bin/zsh
set -euo pipefail

ROOT="/Users/yavar/Documents/CoE/Manipal"
DATA_DIR="$ROOT/data"
OUTPUT_DIR="$ROOT/agent_extraction_review"
RAW_DIR="$OUTPUT_DIR/raw_results"
API_URL="${AGENT_API_URL:-http://localhost:8001/api/agent/test-pdf}"

mkdir -p "$RAW_DIR"

pdfs=("${(@f)$(printf '%s\n' $DATA_DIR/*.pdf | sort -V)}")
total=${#pdfs[@]}
index=0

for pdf in $pdfs; do
  index=$((index + 1))
  file_name=$(basename "$pdf")
  output_file="$RAW_DIR/$file_name.json"

  echo "[$index/$total] Processing $file_name"

  if curl -s -X POST -F "file=@$pdf" "$API_URL" | python3 -c "import sys; open('$output_file', 'w').write(sys.stdin.read())"; then
    python3 - <<PY
import json
path = "$output_file"
payload = json.load(open(path))
summary = payload.get("summary", {})
print(f"[${index}/${total}] Completed {summary.get('pdfName', '$file_name')} in {summary.get('totalLatency', '')} ms using {summary.get('tokensUsed', '')} tokens")
PY
  else
    echo "[$index/$total] Failed $file_name"
  fi
done

echo "Raw agent outputs written to $RAW_DIR"
