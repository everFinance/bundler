import { config } from "dotenv";
import { registerBundleQueueJobs } from "./bundleQueue";

process.env = { ...process.env, ...config().parsed };
if (!process.env.RUN) process.exit(0);
registerBundleQueueJobs();
