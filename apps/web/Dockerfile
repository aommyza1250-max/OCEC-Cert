# ---------- ติดตั้ง dependencies ----------
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY apps/web/package.json apps/web/pnpm-lock.yaml apps/web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---------- build ----------
FROM node:22-alpine AS builder
# วางโครงเหมือนใน repo (apps/web + shared) เพราะเว็บอ่านแคตตาล็อกรางวัลจาก shared/certificate-profiles
# ชุดเดียวกับที่ worker ใช้ — path แบบ ../../shared ต้องชี้ไปที่เดียวกันทั้งในเครื่องและใน image
WORKDIR /repo/apps/web
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY apps/web/ ./
COPY shared/ /repo/shared/
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---------- runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# output: "standalone" ใน next.config.ts ทำให้ image เล็กลงหลายร้อย MB
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./.next/static
COPY --from=builder /repo/apps/web/public ./public
# ต้องมี prisma client + migration ติดมาด้วย เพื่อให้ deploy แล้ว migrate ได้
COPY --from=builder /repo/apps/web/prisma ./prisma
COPY --from=builder /repo/apps/web/node_modules ./node_modules

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma generate && node server.js"]


