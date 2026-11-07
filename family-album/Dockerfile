FROM node:22-alpine
ENV NODE_ENV=production DATA_DIR=/data PORT=8092
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY lib ./lib
COPY public ./public
VOLUME /data
EXPOSE 8092
CMD ["node", "server.js"]
