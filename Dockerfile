FROM oven/bun:1.3-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY src/ ./src/

ENTRYPOINT ["bun", "run", "src/cli/index.ts"]
