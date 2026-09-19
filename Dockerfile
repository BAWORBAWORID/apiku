FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies
RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
    curl \
    wget \
    ca-certificates \
    gnupg \
    unzip \
    xz-utils \
    git \
    build-essential \
    python3 \
    ffmpeg \
    xvfb \
    libgtk-3-0 \
    libgbm1 \
    libasound2 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxi6 \
    libxtst6 \
    libnss3 \
    libcups2 \
    libdrm2 \
    libpango-1.0-0 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libnspr4 \
    libxrandr2 \
    libxfixes3 \
    libxss1 \
    fonts-liberation \
    libappindicator3-1 \
    libu2f-udev \
    xdg-utils \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev && \
    rm -rf /var/lib/apt/lists/*

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get update && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Download Chrome for Testing
RUN mkdir -p /app/src/function/chrome/chrome/linux-150.0.7843.0 && \
    cd /app/src/function/chrome/chrome/linux-150.0.7843.0 && \
    wget -q https://storage.googleapis.com/chrome-for-testing-public/150.0.7843.0/linux64/chrome-linux64.zip && \
    unzip -q chrome-linux64.zip && \
    rm chrome-linux64.zip && \
    chmod +x chrome-linux64/chrome && \
    ln -sf /app/src/function/chrome/chrome/linux-150.0.7843.0/chrome-linux64/chrome /usr/local/bin/chrome

# Install npm packages
COPY package*.json ./

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=true

RUN npm install

# Install Chrome for Puppeteer (auto-match version pinned by puppeteer package)
RUN npx puppeteer browsers install chrome

# Copy source
COPY . .

# Create directories
RUN mkdir -p \
    /app/files \
    /app/data \
    /app/data/session \
    /app/data/sessions \
    /app/logs && \
    chmod -R 777 /app/files /app/data /app/logs

ENV PORT=3000
ENV CHROME_PATH=/app/src/function/chrome/chrome/linux-150.0.7843.0/chrome-linux64/chrome

EXPOSE 3000

CMD ["npm", "start"]
