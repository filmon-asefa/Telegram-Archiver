FROM python:3.11-slim AS backend

WORKDIR /app/backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .

FROM node:20-slim AS frontend

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM python:3.11-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    nodejs npm curl tini && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Backend
COPY --from=backend /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=backend /usr/local/bin/telegram-archiver /usr/local/bin/telegram-archiver
COPY backend/ ./backend/

# Frontend (production build)
COPY --from=frontend /app/frontend/.next ./.next/
COPY --from=frontend /app/frontend/node_modules ./node_modules/
COPY --from=frontend /app/frontend/package.json ./
COPY --from=frontend /app/frontend/public ./public/

# Config
COPY .env.example ./.env.example

# Data volume
VOLUME /app/data

EXPOSE 3000

# Start both services
CMD ["sh", "-c", "PYTHONPATH=/app/backend python -m src.main --listen & npx next start --port 3000"]
