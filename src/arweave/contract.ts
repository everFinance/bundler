import arweave from "./arweave";
import { mkdir } from "fs";
import { SmartWeaveNodeFactory } from "redstone-smartweave";

mkdir("./.swcache", () => null);
const swcClient = SmartWeaveNodeFactory.fileCached(arweave, ".swcache");


export interface ContractState {
  bundlers: [string, string][]
}

export default swcClient;
