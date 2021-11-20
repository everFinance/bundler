import { ExternalTransaction } from "./Transaction";

export interface NewTxBody extends Omit<ExternalTransaction, "peer_address"> {
  receipt: string;
  id: string;
  block: number;
  publicKey: string;
}
