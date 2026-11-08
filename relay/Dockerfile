# The collaboration relay (relay/CLAUDE.md). `ws` is plain JavaScript, so it installs
# on the builder's architecture and only the runtime stage differs per platform.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /relay
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine
WORKDIR /relay
COPY --from=build /relay/node_modules ./node_modules
COPY package.json server.mjs ./
USER node
EXPOSE 4390
CMD ["node", "server.mjs"]
