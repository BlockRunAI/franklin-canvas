# Franklin Canvas — single-container deploy.
# One Node process serves BOTH the built Vite SPA (dist/) and the /api backend,
# so the UI and API share one origin (no CORS, one URL). ffmpeg is needed for
# the video stitch / film-assemble tools.
FROM node:20-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cloud Run injects PORT; bind all interfaces. NODE_ENV=production tightens deps.
# VITE_PAYMENT_MODE=browser → the web build pays x402 with each VISITOR's wallet
# (no shared server wallet). Vite inlines this at build time.
ENV NODE_ENV=production HOST=0.0.0.0 VITE_PAYMENT_MODE=browser

# Install full deps (build needs vite/tsc), build the SPA, then drop dev deps.
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

EXPOSE 8080
CMD ["node", "server.mjs"]
