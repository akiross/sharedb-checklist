FROM node:8
WORKDIR /usr/src/app
COPY . .
# COPY package*.json ./
RUN npm install
RUN npm run build
EXPOSE 8080
CMD ["npm", "start"]
