import { Context } from "koa";
import { currencies, Tx } from "../../../currency";
import { insertBalanceTransactions } from "../../../database/insert.transaction";
import { httpServerConnection } from "../../../database/httpServerConnection.database";
import { currentBlockHeight } from "../../../constants";
import { balanceTransactionExists } from "../../../database/select.transaction";
import logger from "../../../logger";
import { makeError } from "../../../utils/utils";

export async function fundAccount(ctx: Context): Promise<void> {
  const currency = currencies[ctx.params.currency];
  if (!currency) {
    ctx.status = 400;
    ctx.message = "Currency not supported";
    return;
  }

  const { tx_id } = ctx.request.body as { tx_id: string };
  if (!tx_id) {
    logger.info("Undefined tx_id received");
    logger.debug(JSON.stringify(ctx.request.body));
    return makeError(ctx, "Must send non-null tx_id", 400);
  }
  logger.info(`Received ${ctx.params.currency} tx - ${tx_id}`);

  if (await balanceTransactionExists(httpServerConnection, tx_id, ctx.params.currency)) {
    ctx.status = 202;
    ctx.message = "Tx already processed";
    return;
  }

  let tx: Tx;
  try {
    tx = await currency.getTx(tx_id);
  } catch (e) {
    logger.error(`Error occurred while getting tx - ${e}`);
    ctx.status = 400;
    ctx.message = "Invalid tx";
    return;
  }

  if (tx.to !== currency.account.address) {
    ctx.status = 400;
    ctx.message = "Tx not sent to this bundler's address";
    return;
  }

  logger.info(tx.from);
  if (tx.from.match(/^0x[a-fA-F0-9]{40}$/)) {
    tx.from = tx.from.toLowerCase();
  }

  await insertBalanceTransactions(httpServerConnection, [{
    tx_id,
    address: tx.from,
    currency: ctx.params.currency,
    amount: tx.amount.toString(),
    block_height: await currentBlockHeight("arweave"),
    confirmed: tx.confirmed,
  }]);

  ctx.status = 200;
  return;
}
