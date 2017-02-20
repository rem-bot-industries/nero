FROM node:7.5-alpine
LABEL maintainer Wolke "wolke@ram.moe"
RUN npm config set registry http://registry.npmjs.org/ && npm install
WORKDIR /usr/src/
RUN git clone https://github.com/rem-bot-industries/nero.git nero
WORKDIR /usr/src/nero
RUN npm install
ENV ws_host="0.0.0.0"
EXPOSE 8080
ENTRYPOINT [ "node", "index.js" ]