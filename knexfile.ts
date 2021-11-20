import { config } from "dotenv";
import { Knex } from "knex";
import Config = Knex.Config;

config();

export default {
  client: "pg",
  connection: {
    host: process.env.DATABASE_HOST!,
    port: parseInt(process.env.DATABASE_PORT || "5432"),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
  },
  pool: {
    min: 10,
    max: 200,
  },
  migrations: {
    tableName: "migrations",
    loadExtensions: [".ts"],
    extension: "ts",
    directory: "./migrations",
    schemaName: "public",
  },
  onUpdateTrigger: table => `
    CREATE TRIGGER ${table}_updated_at
    BEFORE UPDATE ON ${table}
    FOR EACH ROW
    EXECUTE PROCEDURE on_update_timestamp();
  `
} as Config;
