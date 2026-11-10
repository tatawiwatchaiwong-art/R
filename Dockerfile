FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends r-base-core r-cran-ggplot2 r-cran-dplyr r-cran-tidyr r-cran-readr r-cran-reshape2 r-cran-lubridate r-cran-stringr && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["node","server.js"]
