FROM oven/bun:latest AS build
WORKDIR /tmp
ENV NODE_ENV production
ADD package.json /tmp/package.json
RUN bun install 

FROM oven/bun:latest
ENV NODE_ENV production
WORKDIR /home/node/app/
RUN chown -R node:node /home/node/app
COPY --chown=node:node --from=build /tmp/node_modules /home/node/app/node_modules
COPY --chown=node:node . .
USER node

EXPOSE 8080

CMD ["bun","index.js"]
#ENTRYPOINT ["tail", "-f", "/dev/null"]
