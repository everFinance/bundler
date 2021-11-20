import Arweave from "arweave";
import { config } from "dotenv";

process.env = { ...process.env, ...config().parsed };

const arweave = Arweave.init({
  host: process.env.GATEWAY_HOST,// Hostname or IP address for a Arweave host
  port: +process.env.GATEWAY_PORT,          // Port
  protocol: process.env.GATEWAY_PROTOCOL,  // Network protocol http or https
  timeout: 40000,     // Network request timeouts in milliseconds
  logging: false      // Enable network request logging
});

export default arweave;
