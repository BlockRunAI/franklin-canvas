#!/usr/bin/env bash
# Deploy Franklin Canvas to Google Cloud Run (single container: Vite SPA + API).
#
# Usage:   ./scripts/deploy.sh
# Or npm:  npm run deploy
#
# PAYMENT: the web build (Dockerfile sets VITE_PAYMENT_MODE=browser) charges each
# VISITOR's own wallet via client-side x402 — there is NO shared server wallet.
# The server only runs a transparent /api/gw proxy + ffmpeg + file storage, so it
# needs no funded key. (Optional BASE_CHAIN_WALLET_KEY is only used if you ever
# flip the build back to local-pay.)
set -euo pipefail

PROJECT="blockrun-prod-2026"
SERVICE="franklin-canvas"
REGION="us-central1"

# Optional runtime env: restrict CORS, point at a non-default gateway, or (only
# for a local-pay build) supply a server wallet.
ENVS=""
[ -n "${ALLOWED_ORIGINS:-}" ]       && ENVS="${ENVS},ALLOWED_ORIGINS=${ALLOWED_ORIGINS}"
[ -n "${BLOCKRUN_API_URL:-}" ]      && ENVS="${ENVS},BLOCKRUN_API_URL=${BLOCKRUN_API_URL}"
[ -n "${BASE_CHAIN_WALLET_KEY:-}" ] && ENVS="${ENVS},BASE_CHAIN_WALLET_KEY=${BASE_CHAIN_WALLET_KEY}"
ENVS="${ENVS#,}"

SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "nogit")
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Deploying Franklin Canvas"
echo " project : ${PROJECT}"
echo " service : ${SERVICE} (${REGION})"
echo " commit  : ${SHA}"
echo " pay     : browser wallet (per-visitor x402, no shared server wallet)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

if [ -n "${ENVS}" ]; then
  gcloud run deploy "${SERVICE}" --source . --region "${REGION}" --project "${PROJECT}" \
    --allow-unauthenticated --set-env-vars="${ENVS}" --quiet
else
  gcloud run deploy "${SERVICE}" --source . --region "${REGION}" --project "${PROJECT}" \
    --allow-unauthenticated --quiet
fi

echo
echo "✅ Deployed ${SHA}. URL printed above — set it as NEXT_PUBLIC_CANVAS_URL in franklin-run."
