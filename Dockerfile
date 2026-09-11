# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app

# Camera service dependencies
COPY anubis-guardian/services/camera-service/package*.json /app/camera-service/
WORKDIR /app/camera-service
RUN npm ci --omit=dev --ignore-scripts
WORKDIR /app

# Camera service source
COPY anubis-guardian/services/camera-service/index.js /app/camera-service/
COPY anubis-guardian/services/camera-service/camera-service.test.js /app/camera-service/

# Recording service dependencies
COPY anubis-guardian/services/recording-service/package*.json /app/recording-service/
WORKDIR /app/recording-service
RUN npm ci --omit=dev --ignore-scripts
WORKDIR /app

# Recording service source
COPY anubis-guardian/services/recording-service/index.js /app/recording-service/
COPY anubis-guardian/services/recording-service/recording-service.test.js /app/recording-service/

EXPOSE 8080
ENV NODE_ENV=production
CMD ["node", "camera-service/index.js"]
