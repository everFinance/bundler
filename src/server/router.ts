import Router from "@koa/router";
import { fileUpload, initialChecks, sendSignedResponse, verifyUpload } from "./routes/data/postData";
import { infoRoute } from "./routes/info/infoRoute";
import { getTx, getTxHead } from "./routes/data/getTx";
import { getPeers, getRandomPeers } from "./routes/info/peers";
import { RateLimit } from "koa2-ratelimit";
import { newTx } from "./routes/newTx";
import { getPublic } from "./routes/info/getPublic";
import { statusRoute } from "./routes/info/statusRoute";
import bodyParser from "koa-bodyparser";
import { getPrice } from "./routes/data/getPrice";
import { getTopPeers } from "./routes/info/getTopPeers";
import { getWithdrawals } from "./routes/accounts/getWithdrawals";
import { withdrawUserBalance } from "./routes/accounts/withdraw";
import { fundAccount } from "./routes/accounts/fundAccount";
import { getUserBalance } from "./routes/accounts/getBalance";

const rateLimiter = RateLimit.middleware({
  interval: 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 requests per interval
});

const postTxRateLimiter = RateLimit.middleware({
  interval: 60 * 1000, // 1 minute
  max: 10000, // limit each IP to 100 requests per interval
});

const jsonBodyParser = bodyParser({
  enableTypes: ["json"],
  jsonLimit: "100kb",
});

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export const router = new Router()
  .get("/", infoRoute)
  .get("/info", infoRoute)
  .get("/public", getPublic)
  .get("/status", statusRoute)
  .post("/account/balance/:currency", jsonBodyParser, fundAccount)
  .get("/account/balance/:currency", getUserBalance)
  .get("/account/balance", getUserBalance)
  .get("/price/:size", getPrice)
  .get("/peers", getPeers)
  .get("/miners", getTopPeers)
  .get("/peers/random/:count", getRandomPeers)
  .post("/tx/:currency", postTxRateLimiter, initialChecks, fileUpload, verifyUpload, sendSignedResponse)
  .post("/tx", postTxRateLimiter, initialChecks, fileUpload, verifyUpload, sendSignedResponse)
  .get("/price/:currency/:size", getPrice)
  .head("/tx/:txId/data", getTxHead)
  .get("/tx/:txId/data", getTx)
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  .post("/newTx", rateLimiter, jsonBodyParser, newTx)
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  .post("/account/withdraw", jsonBodyParser, withdrawUserBalance)
  .get("/account/withdrawals/:currency", getWithdrawals)
  .get("/account/withdrawals", getWithdrawals);
