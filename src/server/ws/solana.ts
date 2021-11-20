import axios from "axios";

export async function solanaTxValid(id: string, expected: number): Promise<boolean> {
  const response = await axios.post("https://api.mainnet-beta.solana.com/",
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [
        id,
        {
          encoding: "json",
          commitment: "confirmed"
        }
      ]
    }),
    {
      headers: {
        "Content-Type": "application/json"
      }
    });
  const meta = response.data.result.meta;
  const received = meta.preBalances[1] - meta.postBalances[1];

  return expected >= (received * 0.95);
}
