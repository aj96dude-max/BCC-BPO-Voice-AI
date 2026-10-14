FROM node:20-alpine
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY backend/ ./
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "index.js"]
