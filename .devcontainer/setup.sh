set -e
cd "$(dirname "$0")/.."
sudo apt-get update -qq && sudo apt-get install -y -qq fonts-dejavu-core fonts-liberation > /dev/null || true
pip install -q -e ocr -r server/requirements.txt
cd web && npm ci --no-audit --no-fund
