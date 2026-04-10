# Use official Playwright image — Chromium + all system deps pre-installed
FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

# Install all dependencies (including dev for TS compile)
COPY package*.json ./
RUN npm ci

# Compile TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies for the final image
RUN npm ci --omit=dev

EXPOSE 3001

CMD ["node", "dist/index.js"]
