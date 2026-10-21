FROM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS base
WORKDIR /app
COPY docker/patch-bun-ca.py /tmp/patch-bun-ca.py
RUN apk upgrade --no-cache \
    && apk add --no-cache ca-certificates 'ca-certificates-bundle>=20261020-r0' \
    && apk add --no-cache --virtual .ca-patch python3 \
    && python3 /tmp/patch-bun-ca.py /usr/local/bin/bun \
    && apk del .ca-patch \
    && rm /tmp/patch-bun-ca.py

FROM base AS builder
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .

FROM base
RUN apk add --no-cache curl
COPY --from=builder /app/package.json ./
COPY --from=builder /app/bun.lock ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/node_modules ./node_modules
ENV NODE_ENV=production
CMD ["bun", "run", "src/index.ts"]
