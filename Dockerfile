FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Build the TypeScript code
RUN npm run build

# Expose backend port
EXPOSE 3001

# Start the backend server
CMD ["npm", "start"]
