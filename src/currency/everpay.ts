import { CreateTxData, currencies, Tx } from "./index";
import keccak256 from "keccak256";
import { ethers, Wallet } from "ethers";
import BigNumber from "bignumber.js";
import logger from "../logger";
import Everpay from "everpay";
import arweave from "../arweave/arweave";
import base64url from "base64url";
const everpay = new Everpay({ debug: false })

export async function everpayOwnerToAddress(owner: any): Promise<string> {
  if (owner.length > 32) { // todo ar address
    return arweave.wallets.ownerToAddress(Buffer.isBuffer(owner) ? base64url(owner) : owner);
  }
  // ethereum address
  return "0x" + keccak256(owner.slice(1)).slice(-20).toString("hex");
}

export async function getEverPayTx(txId: string): Promise<Tx> {
  const tx = await everpay.txByHash(txId);
  // todo not find

  return {
    from: tx.from,
    to: tx.to,
    blockHeight: new BigNumber(0),
    amount: new BigNumber(tx.amount,10),
    pending: false,
    confirmed: true
  };
}

export async function getEverPayFee(): Promise<BigNumber> {
  const fee = await everpay.fee("AR")
  return new BigNumber(fee.transferFee, 10) // always is 0
}

export async function createMaticTx({ amount, to }: CreateTxData, key: Buffer): Promise<any> {
  try {
    const provider = new ethers.providers.JsonRpcProvider(currencies["matic"].provider);

    await provider._ready();
    const wallet = new Wallet(key, provider);
    const _amount = ethers.utils.hexlify(BigNumber.isBigNumber(amount) ? "0x" + amount.toString(16) : amount);

    const estimatedGas = await provider.estimateGas({ to, value: _amount });
    const gasPrice = await provider.getGasPrice();

    const tx = await wallet.populateTransaction({
      to,
      value: _amount,
      gasPrice,
      gasLimit: estimatedGas
    });

    const signedTx = await wallet.signTransaction(tx);
    const txId = "0x" + keccak256(Buffer.from(signedTx.slice(2), "hex")).toString("hex");
    return { txId, tx: signedTx };
  } catch (e) {
    logger.error(e);
    throw e;
  }
}

export async function sendMaticTx(tx: string): Promise<void> {
  try {
    const provider = new ethers.providers.JsonRpcProvider(currencies["matic"].provider);
    await provider._ready();

    await provider.sendTransaction(tx);
  } catch (e) {
    logger.error(`Error occurred while sending a MATIC tx - ${e}`);
    throw e;
  }
}
