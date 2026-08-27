FROM node:24-alpine AS build
WORKDIR /app
COPY . .
RUN npm install && npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node", "dist/server/entry.mjs"]
