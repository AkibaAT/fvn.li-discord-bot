FROM oven/bun:1.4.4-alpine@sha256:4cf82f5686b196504fe119db3fcd9185b191f82ece82c40680e597228ec6070a AS base
WORKDIR /app
RUN apk upgrade --no-cache \
    && apk add --no-cache ca-certificates 'ca-certificates-bundle>=20261020-r0'

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
