import { Currency } from "./Transaction";

export interface BalanceTransaction {
  tx_id: string;
  address: string;
  currency: Currency;
  amount: number | string;
  block_height: number;
  confirmed: boolean;
}

export interface ExternalBalance {
  address: string;
  peer_address: string;
  balance: number;
}
