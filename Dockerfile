FROM node:22-alpine AS deps

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/adapters/package.json packages/adapters/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/core/package.json packages/core/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS source
COPY . .

FROM source AS api
RUN pnpm --filter @vol-arb/api build
ENV NODE_ENV=production
ENV API_PORT=4000
EXPOSE 4000
CMD ["pnpm", "--filter", "@vol-arb/api", "start"]

FROM source AS web
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
ARG NEXT_PUBLIC_ALLOW_TESTNET_WATCH_MINT=false
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_ALLOW_TESTNET_WATCH_MINT=$NEXT_PUBLIC_ALLOW_TESTNET_WATCH_MINT
RUN pnpm --filter @vol-arb/web build
ENV NODE_ENV=production
ENV WEB_PORT=3000
EXPOSE 3000
CMD ["pnpm", "--filter", "@vol-arb/web", "start"]
