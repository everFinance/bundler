import PolygonSigner from "arbundles/build/signing/chains/PolygonSigner";
import { CreateTxData, currencies, Tx } from "./index";
import keccak256 from "keccak256";
import { ethers, Wallet } from "ethers";
import BigNumber from "bignumber.js";
import logger from "../logger";

export async function polygonSign(message: Uint8Array): Promise<Uint8Array> {
  const signer = new PolygonSigner(currencies["matic"].account.key);
  return signer.sign(message);
}

export async function polygonVerify(pub, data, sig): Promise<boolean> {
  return PolygonSigner.verify(pub, data, sig);
}

export async function polygonOwnerToAddress(owner: Uint8Array): Promise<string> {
  return "0x" + keccak256(owner.slice(1)).slice(-20).toString("hex");
}

export async function getPolygonTx(txId: string): Promise<Tx> {
  const provider = new ethers.providers.JsonRpcProvider(currencies["matic"].provider);

  const response = await provider.getTransaction(txId);

  if (!response) throw new Error("Tx doesn't exist");

  return {
    from: response.from,
    to: response.to,
    blockHeight: new BigNumber(response.blockNumber),
    amount: new BigNumber(response.value.toHexString(), 16),
    pending: !response.blockHash,
    confirmed: response.confirmations >= 10
  };
}

export async function polygonGetHeight(): Promise<BigNumber> {
  const provider = new ethers.providers.JsonRpcProvider(currencies["matic"].provider);

  const response = await provider.send("eth_blockNumber", []);

  return new BigNumber(response, 16);
}

export async function getMaticFee(amount: BigNumber, to: string): Promise<BigNumber> {
  const provider = new ethers.providers.JsonRpcProvider(currencies["matic"].provider);

  await provider._ready();

  const tx = {
    to,
    value: "0x" + amount.toString(16)
  };

  const estimatedGas = await provider.estimateGas(tx);
  const gasPrice = await provider.getGasPrice();

  return new BigNumber(estimatedGas.mul(gasPrice).toString());
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
