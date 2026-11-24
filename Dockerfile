# syntax=docker/dockerfile:1

FROM node:22-alpine AS frontend-build
WORKDIR /app

COPY notebook-chatbot-frontend/package*.json ./notebook-chatbot-frontend/
RUN npm ci --prefix notebook-chatbot-frontend

COPY notebook-chatbot-frontend ./notebook-chatbot-frontend
ARG VITE_GEMINI_API_URL=
ENV VITE_GEMINI_API_URL=$VITE_GEMINI_API_URL
RUN npm --prefix notebook-chatbot-frontend run build

FROM node:22-alpine AS server-deps
WORKDIR /app

COPY server/package*.json ./server/
RUN npm ci --prefix server --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server ./server
COPY --from=frontend-build /app/notebook-chatbot-frontend/dist ./notebook-chatbot-frontend/dist

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/index.js"]
