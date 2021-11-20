import logger from "../logger";
import { createHttpLink } from "apollo-link-http";
import ApolloClient from "apollo-client";
import { InMemoryCache } from "apollo-boost";
import { gql } from "apollo-server-koa";
import fs from "fs";
import { getBundlerPeersFromDb } from "../database/select.transaction";
import { insertExternalDataItem } from "../database/insert.transaction";
import { workerConnection } from "../database/workerConnection.database";

// TODO: Implement syncing from weave
export async function syncDataItems(): Promise<void> {
  logger.info("Syncing from the weave");

  const peers = await getBundlerPeersFromDb(workerConnection);

  peers.slice(0, 1).map(async (peer) => {
    const link = createHttpLink({
      uri: `http://${peer.host}:${peer.port}/graphql`,
      fetch,
      fetchOptions: { timeout: 10000 },
    });

    let after = "";
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const client = new ApolloClient({
        link: link,
        cache: new InMemoryCache(),
      });

      const query = gql`${await fs.promises.readFile("./src/graphql/queries/dataItems.graphql").then(b => b.toString())}`;

      const response = await client
        .query({
          query,
          variables: {
            transactionAfter: after
          }
        });

      const length = response.data.transaction.length;
      if (length && length === 0) {
        break;
      }

      await insertExternalDataItem(workerConnection, response.data.transaction);

      after = response.data.transaction[length - 1].data_item_id;
    }
  });

}
