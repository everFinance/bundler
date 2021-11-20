import { Context } from "koa";
import logger from "../../../logger";
import { currencies } from "../../../currency";
import { getBalance } from "../../../arweave/utils";
import { httpServerConnection } from "../../../database/httpServerConnection.database";
import { makeError } from "../../../utils/utils";

export async function getUserBalance(ctx: Context): Promise<void> {
  const currency = ctx.params.currency || "arweave";
  let address = ctx.request.query["address"] as string || "";

  if (!address) return makeError(ctx, "Address not provided");
  if (address.match(/^0x[a-fA-F0-9]{40}$/)) address = address.toLowerCase();

  logger.debug(`Currency: ${currency}`);

  if (!currencies[currency]) return makeError(ctx, "Unknown/Unsupported currency");

  try {
    const balance = await getBalance(httpServerConnection, currency, address);

    ctx.res.statusCode = 200;
    ctx.response.body = { balance: balance.isGreaterThan(0) ? balance.toString(10) : 0 };
  } catch (e) {
    logger.error(`Error occurred while getting user balance - ${e}`);
    return makeError(ctx, "Cannot fetch user balance", 500);
  }
}
