import { httpServerConnection } from "../../../database/httpServerConnection.database";

export async function getNonce(address: string, currency: string): Promise<number> {
  const withdrawals = await httpServerConnection("balance_transactions")
    .where("currency", "=", currency)
    .where("address", "=", address)
    .where("amount", "<", 0)
    .count()
    .then(r => r[0].count) as string;
  return (parseInt(withdrawals) + 1);
}
