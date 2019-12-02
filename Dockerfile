FROM node:8

WORKDIR /usr/src/app

# Copy package info so we can install deps
# These can be kept in cache, won't change often
COPY package*.json ./
RUN npm install

# Copy sources and do actual build
# This is more likely to change
COPY . .
RUN npm run build

EXPOSE 8080
CMD ["npm", "start"]
