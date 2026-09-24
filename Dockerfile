FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp
WORKDIR /app
COPY package.json server.js index.html ./
# yt-dlp is updated on every start because platforms change often
CMD ["sh","-c","yt-dlp -U || true; node server.js"]
