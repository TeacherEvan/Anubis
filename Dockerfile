# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app

# Install only what the camera-service needs at runtime
COPY anubis-guardian/services/camera-service/package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY anubis-guardian/services/camera-service/index.js ./
COPY anubis-guardian/services/camera-service/camera-service.test.js ./

EXPOSE 8080

ENV NODE_ENV=production
CMD ["node", "index.js"]
