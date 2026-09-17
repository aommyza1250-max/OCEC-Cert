# ---------- ติดตั้ง dependencies ----------
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---------- build ----------
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma generate ต้องรันก่อน next build (มีอยู่ในสคริปต์ build แล้ว)
# DATABASE_URL ตอน build เป็นค่าหลอก — Prisma ต้องการแค่ให้ parse ได้ ไม่ได้ต่อจริง
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---------- runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# output: "standalone" ใน next.config.ts ทำให้ image เล็กลงหลายร้อย MB
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# ต้องมี prisma client + migration ติดมาด้วย เพื่อให้ deploy แล้ว migrate ได้
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
