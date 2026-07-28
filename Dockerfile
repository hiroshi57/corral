# Corral デーモン + ダッシュボードの自己ホスト用イメージ（#19 オンプレ/VPC）
# マルチステージ: web をビルド → server をビルド → 実行イメージ
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm install
COPY . .
# web は同一オリジン配信（本番はデーモンが web/dist を配る）。デモフラグは付けない
RUN npm run build -w web && npm run build -w server

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# git はワークツリー操作に必須
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
# 非rootで実行（サンドボックス）
USER node
EXPOSE 4319
# 0.0.0.0 で待受（コンテナ外から到達させる場合）。Host 検証は allowedHosts で制御
ENV CORRAL_HOST=0.0.0.0 CORRAL_PORT=4319 CORRAL_DEMO=0
CMD ["node", "server/dist/index.js"]
