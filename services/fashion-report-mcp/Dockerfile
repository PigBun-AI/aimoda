FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/
EXPOSE 18770
CMD ["node", "dist/index.js", "--transport=http"]
