# syntax=docker/dockerfile:1

# ── 베이스 (glibc) — better-sqlite3 prebuild 사용 가능 ──
FROM node:20-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ── 의존성 설치 (better-sqlite3 컴파일 대비 빌드툴 포함) ──
FROM base AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ── 빌드 (Next standalone) ──
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 빌드 시점 더미 키 (실제 값은 런타임에 주입 — 이미지에 시크릿 미포함)
ENV ENCRYPTION_KEY=build-time-dummy-not-used-at-runtime
RUN npm run build

# ── 런타임 ──
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATABASE_PATH=/app/data/mailbento.db
ENV MIGRATIONS_DIR=/app/drizzle

RUN useradd -m -u 1001 nodejs

# standalone 출력물 + 정적 자산 + 마이그레이션 SQL
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/drizzle ./drizzle

# DB 영속 디렉터리 (compose 볼륨으로 마운트)
RUN mkdir -p /app/data && chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 3000
CMD ["node", "server.js"]
