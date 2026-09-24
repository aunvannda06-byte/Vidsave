FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip ffmpeg ca-certificates git \
      build-essential pkg-config libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev libpixman-1-dev \
 && rm -rf /var/lib/apt/lists/* \
 && pip3 install --break-system-packages -U --pre "yt-dlp[default,curl-cffi]" bgutil-ytdlp-pot-provider \
 && git clone --depth 1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil \
 && cd /opt/bgutil/server && npm ci && npx tsc
# ^ build-essential/libcairo etc. are here because the PO-token server's "canvas" dependency needs to
# compile native code; without them `npm ci` fails and the WHOLE docker build fails silently at that step.
# yt-dlp is installed with --pre (nightly builds): platforms like TikTok change their site format
# often enough that PyPI's stable releases can lag behind by days/weeks, causing "Unexpected
# response from webpage request" errors on an otherwise-current stable install.
WORKDIR /app
COPY package.json server.js index.html ./
COPY extractors ./extractors
COPY lib ./lib
# yt-dlp and the PO-token plugin are updated on every start because platforms change often.
# The bgutil server (127.0.0.1:4416) mints proof-of-origin tokens so YouTube trusts requests
# coming from this server's IP without needing cookies/login — see server.js for details.
CMD ["sh","-c","pip3 install --break-system-packages -q -U --pre 'yt-dlp[default,curl-cffi]' bgutil-ytdlp-pot-provider || true; (node /opt/bgutil/server/build/main.js || echo '[bgutil] PO-token server exited/failed to start') & for i in $(seq 1 20); do node -e 'fetch(`http://127.0.0.1:4416/ping`).then(()=>process.exit(0)).catch(()=>process.exit(1))' && break; sleep 1; done; node server.js"]
