import { SQLDataSource } from "datasource-sql";
import base64url from "base64url";

export default class BundlerAPI extends SQLDataSource {
  getDataItems(ids?: string[], from?: string): Promise<any> {
    let query = this.knex
      .select(["data_item_id", "address", "current_block as block", "expected_block", "signature"])
      .from("data_items")
      .orderBy("data_item_id", "asc")
      .limit(10);

    if (ids) {
      query = query
        .where("data_item_id", "in", ids)
    }

    if (from) {
      query = query
        .where("data_item_id", ">", from)
    }

    return query.then(r => r.map(row => ({
      ...row,
      block: +row.block,
      expected_block: +row.expected_block,
      signature: base64url.encode(row.signature, "hex")
    })));
  }

  async getBalances(allowExternal = false, addresses?: string[]): Promise<any> {
    let query = this.knex
      .select(["address", "balance", this.knex.raw("false as external")])
      .from("balances");


    if (addresses) {
      query = query.where("address", "in", addresses);
    }

    if (allowExternal) {
      query = query
        .union((self) => {
            self
              .select(["address", "balance", this.knex.raw("true as external")])
              .from("external_balances");
            if (addresses) {
              self.where("address", "in", addresses);
            }
          }
        );
    }


    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return query.then(r => r.map(row => ({ ...row, balance: +row.balance })));
  }
}

