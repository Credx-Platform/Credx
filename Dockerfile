FROM node:20-alpine

WORKDIR /app

# Install native build tools for better-sqlite3
RUN apk add --no-cache python3 make g++

# Copy and install dependencies first (layer cache)
COPY onboarding/package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY onboarding/ .

# Data directory for SQLite (mount a Railway volume here for persistence)
RUN mkdir -p /app/data

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]
