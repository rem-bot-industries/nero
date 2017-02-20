FROM node:7.5-alpine
LABEL maintainer Wolke "wolke@ram.moe"
RUN npm config set registry http://registry.npmjs.org/ && npm install
RUN npm install
ENV ws_host="0.0.0.0"
EXPOSE 8080
ENTRYPOINT [ "node", "index.js" ]