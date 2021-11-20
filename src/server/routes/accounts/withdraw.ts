import { Context } from "koa";
import logger from "../../../logger";
import { currencies } from "../../../currency";
import { getBalance } from "../../../arweave/utils";
import { httpServerConnection } from "../../../database/httpServerConnection.database";
import { currentBlockHeight } from "../../../constants";
import { insertBalanceTransactions } from "../../../database/insert.transaction";
import { Currency } from "../../../types/Transaction";
import { deepHash } from "arbundles";
import { stringToBuffer } from "arweave/node/lib/utils";
import { getNonce } from "./getNonce";
import BigNumber from "bignumber.js";
import { redisClient } from "../../../redis/client";


interface WithdrawBody {
  publicKey: string | Buffer,
  currency: string,
  amount: string, //atomic units
  nonce: number,
  signature: Buffer | Uint8Array
  address?: string
}

export async function withdrawUserBalance(ctx: Context): Promise<void> {

  //maybe use JSONSchema to validate the object further.

  let data = ctx.request.body
  const currency = data.currency;



  try {
    // re-parse botched serialsation >:c
    // (thanks a lot JS)
    if (data.publicKey.type === "Buffer") {
      data.publicKey = Buffer.from(data.publicKey);
    }

    if (data.signature.type === "Buffer") {
      data.signature = Buffer.from(data.signature);
    } else {
      data.signature = Uint8Array.from(Object.values(data.signature));
    }

    //logger.debug(JSON.stringify(data.signature));
    // for some reason the buffer isn't re-parsed properly
    //data.signature = Buffer.from(data.signature);
    //data.signature = Uint8Array.from(data.signature);
    logger.debug(JSON.stringify(data));
    // aooky type after we've reserialised.
    data = data as WithdrawBody;


    // default to failure status code
    ctx.res.statusCode = 400;
    // get the address of the signer

    //WithdrawBody.address = await arweave.wallets.ownerToAddress(WithdrawBody.publicKey);
    logger.debug(`withdrawUserBalance:currency: ${currency}`);
    if (!currencies[currency]) {
      ctx.res.statusMessage = "Unknown/Unsupported currency"
      return;
    }

    const c = currencies[currency];
    data.address = await c.ownerToAddress(data.publicKey);

    logger.verbose(`Processing withdrawal request for ${data.address}`);

    // validate their address is valid
    // if (!isArweaveAddress(WithdrawBody.address)) {
    //   ctx.res.statusMessage = "You must include valid address in the url";
    //   return;
    // }
    // check if their withdrawal WithdrawBody is cryptographically valid

    logger.debug(JSON.stringify(data));
    const isValid = await validateWithdrawal(data);
    logger.debug(`Is valid: ${isValid}`);
    if (!isValid) {
      ctx.res.statusMessage = "withdrawal request validation failed";
      return;
    }

    // TODO: LOCK UPLOADS NOW
    await redisClient.set(`Bundler_node:lock:${data.address}`, "LOCKED", { PX: 2000 });

    // get their balance
    const balance = await getBalance(httpServerConnection, currency, data.address as string);
    logger.debug(`Balance for ${data.address} is ${balance}`);
    const requested = new BigNumber(data.amount);

    if (!requested.isInteger()) {
      ctx.res.statusMessage = "Requested amount must be an integer";
      return;
    }

    if (requested.isLessThan(0)) {
      ctx.res.statusMessage = "Invalid withdraw amount";
      return;
    }
    // if they can't afford the requested amount
    if (balance.minus(requested).isLessThan(0)) {
      ctx.res.statusMessage = "Insufficient balance";
      return;
    }
    // network-specific reward (in atomic units)
    const reward = await c.getFee(0);
    logger.debug(`Reward is ${reward} for ${currency}`);
    // Total amount being taken from the account
    const total = requested.plus(reward);

    if (balance.minus(total).isLessThan(0)) {
      ctx.res.statusMessage = "Insufficient balance"
      return;
    }

    const bundlrBal = await getBalance(httpServerConnection, currency, c.account.address);

    if (bundlrBal.isLessThan(total)) {
      logger.error(`Bundler wallet does not have sufficient ${c.base[0]} for a withdrawal!`);
      logger.debug(`bundler balance: (${c.account.address}) ${bundlrBal}`);
      ctx.res.statusCode = 500;
      return;
    }

    const jwk = c.account.key;

    const now = performance.now();
    const { txId, tx } = await c.createTx({
      to: data.address,
      amount: requested,
      fee: reward.toString(),
    }, jwk);

    logger.debug(`Creating tx took ${performance.now() - now}`);

    logger.debug(currency.toUpperCase());

    // add withdrawal action to DB
    await insertBalanceTransactions(httpServerConnection, [{
      tx_id: txId,
      address: data.address,
      currency: Currency[currency.toUpperCase()],
      block_height: await currentBlockHeight("arweave"),
      amount: total.negated().toString(),
      confirmed: false,
    }]);
    logger.debug("Added balance tx to DB");
    await c.sendTx(tx);
    logger.debug("Sent tx to network");

    ctx.res.statusCode = 200;
    ctx.res.statusMessage = JSON.stringify({
      tx_id: tx.id,
      requested: requested.toString(),
      fee: reward,
      final: total,
    });

    return;
  } catch (e) {
    logger.error(`Withdrawal for address ${data.address} failed!`);
    logger.error(e);
    logger.error(`Withdrawal data debug dump: ${JSON.stringify(data)}`);
  }

}


async function validateWithdrawal(data: WithdrawBody) {
  let isValid = false;
  const nonce = await getNonce(data.address, data.currency);
  logger.debug(`Testing nonce: ${nonce}`);
  if (data.nonce != nonce) {
    return false;
  }
  try {
    const deephash = await deepHash([stringToBuffer(data.currency), stringToBuffer(data.amount.toString()), stringToBuffer(nonce.toString())]);
    //isValid = await Arweave.crypto.verify(WithdrawBody.publicKey, deephash, WithdrawBody.signature);
    isValid = await currencies[data.currency].verify(data.publicKey, deephash, data.signature);
  } catch (e) {
    // include WithdrawBody for debug
    logger.debug(`Validation: data - ${JSON.stringify(data)} `);
    logger.error(`Error validating data - ${e} `);
    return false;
  }
  return isValid;
}
