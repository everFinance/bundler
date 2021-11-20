import * as Minio from "minio";
import { config } from "dotenv";

process.env = { ...process.env, ...config().parsed };

export const s3 = new Minio.Client({
  endPoint: process.env.S3_ENDPOINT,
  port: +process.env.S3_PORT,
  accessKey: process.env.S3_ACCESS_KEY,
  secretKey: process.env.S3_SECRET_KEY,
  region: process.env.S3_REGION,
  useSSL: (process.env.S3_USE_SSL === "true")
});
