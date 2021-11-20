import { runServer } from "./server";
import { config } from "dotenv";

process.env = { ...process.env, ...config().parsed };
if (!process.env.RUN) process.exit(0);

(async function () {
  await runServer();
})();
