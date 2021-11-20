
export enum Currency {
  ARWEAVE = "arweave",
  SOLANA = "solana",
  AVALANCHE = "avalanche",
  MATIC = "matic"
}

export abstract class Transaction {
  data_item_id: string;
  address: string;
  size: number;
  fee: number;
  currency: Currency;
  fee_transaction?: string;
  signature: Uint8Array;
  current_block: number;
  expected_block: number;
}

export abstract class ExternalTransaction {
  data_item_id: string;
  address: string;
  peer_address: string;
  signature: string;
  current_block: number;
  expected_block: number;
}

