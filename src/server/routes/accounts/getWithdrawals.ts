import { Context } from "koa";
import logger from "../../../logger";
import { currencies } from "../../../currency";
import { getNonce } from "./getNonce";
import { makeError } from "../../../utils/utils";

export async function getWithdrawals(ctx: Context): Promise<void> {
  const currency = ctx.params.currency || "arweave";
  const address = `${ctx.request.query["address"]}`;

  logger.debug(`Requesting withdrawals of ${address}`);
  if (!currencies[currency]) return makeError(ctx, "Unknown/Unsupported currency");

  ctx.res.statusCode = 200;
  ctx.response.body = await getNonce(address, currency);
  return;
}
