FROM node:16-alpine AS build
WORKDIR /tmp
ENV NODE_ENV production
ADD package.json /tmp/package.json
RUN npm install 

FROM node:16-alpine
ENV NODE_ENV production
RUN npm install pm2 -g
WORKDIR /home/node/app/
RUN chown -R node:node /home/node/app
COPY --chown=node:node --from=build /tmp/node_modules /home/node/app/node_modules
COPY --chown=node:node . .
USER node

EXPOSE 8080

CMD ["node","index.js"]
#ENTRYPOINT ["tail", "-f", "/dev/null"]
