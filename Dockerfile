FROM rocker/r-ver:4.4.2
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates pandoc poppler-utils \
    libfontconfig1-dev libfreetype6-dev libharfbuzz-dev libfribidi-dev libpng-dev libtiff-dev libjpeg-dev libxml2-dev libcurl4-openssl-dev libssl-dev fonts-liberation \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*
RUN R -q -e 'install.packages(c("dplyr","tidyr","readr","readxl","ggplot2","reshape2","lubridate","stringr","skimr","gtsummary","flextable","officer"))'
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["node","server.js"]
