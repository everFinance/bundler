import knex from "knex";
import { config } from "dotenv";

process.env = { ...process.env, ...config().parsed };

export const httpServerConnection = knex({
  client: "pg",
  pool: { min: 50, max: 200 },
  connection: {
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || "5432"),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    multipleStatements: true,
    supportBigNumbers: true,
    bigNumberStrings: true
  },
});
