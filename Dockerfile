# Production Dockerfile for NexDesign Node.js Server & Frontend
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package manifests
COPY package*.json ./

# Install build tools for native modules (deasync, better-sqlite3)
RUN apk add --no-cache python3 make g++

# Install dependencies
RUN npm install

# Copy source files
COPY . .

# Build Vite frontend bundle
RUN npm run build

# Expose server port
EXPOSE 3001

# Production Environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Start Server
CMD ["node", "server/index.js"]
