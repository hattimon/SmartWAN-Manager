FROM tailscale/tailscale:stable AS tailscale

FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssh-client ca-certificates iptables \
  && rm -rf /var/lib/apt/lists/*

COPY --from=tailscale /usr/local/bin/tailscale /usr/local/bin/tailscaled /usr/local/bin/

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV SMARTWAN_DATA_DIR=/data

COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src ./src
COPY router ./router

VOLUME ["/data"]
EXPOSE 8080

CMD ["node", "server/index.js"]
