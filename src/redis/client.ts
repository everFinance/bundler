import { createClient } from "redis";
import logger from "../logger";
import { config } from "dotenv";

process.env = { ...process.env, ...config().parsed };

export const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: +process.env.REDIS_PORT,
  },
  username: process.env.REDIS_USER,
  password: process.env.REDIS_PASSWORD
});
redisClient.connect();
redisClient.on("error", (err) => logger.error(`Error occurred in Redis client: ${err.message}`));
