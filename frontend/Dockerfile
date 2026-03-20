# Stage 1: Build the React application
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Production runtime with nginx
FROM nginx:1.27-alpine

# Remove default nginx.conf
RUN rm /etc/nginx/conf.d/default.conf

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy reports volume mount point (read-only, bind-mounted at runtime)
RUN mkdir -p /reports

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
