FROM node:24-alpine AS build
WORKDIR /app
COPY . .
RUN npm install && npm run build

FROM node:24-alpine
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

ENV HOSTNAME=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
