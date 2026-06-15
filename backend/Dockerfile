FROM node:20-alpine

# Install FFmpeg and python/make/g++ for native builds if webtorrent needs them
RUN apk update && apk add --no-cache \
    ffmpeg \
    python3 \
    make \
    g++ \
    bash

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

# Create cache directory
RUN mkdir -p /tmp/streamcache

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "server.js"]
