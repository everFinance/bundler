import axios from "axios";
import { deletePeer } from "./cron/crawlForPeers";
import logger from "./logger";

axios.interceptors.response.use(
  response => response,
  error => {
    if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") deletePeer(`${error.address}:${error.port}`, "peers")
      .catch(logger.error);
    return Promise.reject(error);
  }
)

export default axios;

