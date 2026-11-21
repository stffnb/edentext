# Self-hosting: build the static app and serve it. No server side, no state.
# The build stage is pinned to the builder's architecture; its output is static
# files, so only the nginx stage differs per target platform.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
COPY . .
# Sessions go to a relay at /relay beside the app (EDENTEXT_RELAY_UPSTREAM or the chart
# wires one up); without one there, the app finds no relay and offers none.
ARG VITE_COLLAB_RELAY=same-origin
RUN npm ci && VITE_COLLAB_RELAY=$VITE_COLLAB_RELAY npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# AI, dictation and relay presets and proxies from EDENTEXT_* variables (docs/self-hosting.md).
COPY --chmod=755 docker/40-edentext.sh /docker-entrypoint.d/40-edentext.sh
