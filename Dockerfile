# Production Dockerfile for NexDesign Node.js Server & Frontend
FROM node:20-slim

WORKDIR /app

# Install build dependencies for native modules (python3, make, g++)
RUN apt-get update && apt-get install -y python3 make g++ --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Copy package manifests
COPY package*.json ./

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
