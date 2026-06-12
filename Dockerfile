# Stage 1: Build the Vite bundle (host + player clients)
FROM node:22-bookworm-slim AS frontend-builder
WORKDIR /build
COPY package.json package-lock.json vite.config.js ./
RUN npm ci
COPY frontend/ frontend/
COPY src/ src/
COPY static/ static/
RUN npm run build

# Stage 2: Python runtime (Flask + Socket.IO via eventlet)
FROM python:3.12-slim-bookworm

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY server/ server/
COPY --from=frontend-builder /build/dist/ dist/

ENV PORT=8000 \
    FLASK_DEBUG=0

EXPOSE 8000

CMD ["python", "server/app.py"]
