FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci (not install) - installs exactly what's in the lockfile, so a build
# can't silently pick up a newer, unvetted transitive dependency version.
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY --from=builder /app ./

# Run as a non-root user, same reasoning as the backend Dockerfile.
RUN useradd --create-home --uid 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 3000
CMD ["npm", "start"]
