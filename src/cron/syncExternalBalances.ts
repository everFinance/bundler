import logger from "../logger";
import { getBundlerPeersFromDb } from "../database/select.transaction";
import * as fs from "fs";
import ApolloClient  from "apollo-client";
import fetch from "node-fetch";
import { createHttpLink } from "apollo-link-http";
import { InMemoryCache } from "apollo-boost";
import { gql } from "apollo-server-koa";
import { insertExternalBalance } from "../database/insert.transaction";
// import { bundlerPeerQueue } from "../queues/queues";
import { workerConnection } from "../database/workerConnection.database";

const config = JSON.parse(fs.readFileSync("./config.json").toString());

export async function syncExternalBalances(): Promise<void> {
  logger.info("Syncing external balances");
  const peers = await getBundlerPeersFromDb(workerConnection);


  for (const peer of peers) {
    if (peer.host === config.hostname) {
      logger.verbose("Skipping hostname");
      continue;
    }

    logger.verbose(`Getting external balances from ${peer.host}`);

    const link = createHttpLink({ uri: `http://${peer.host}:${peer.port}/graphql`, fetch, fetchOptions: { timeout: 10000 } });

    const client = new ApolloClient( {
      link: link,
      cache: new InMemoryCache(),
    });

    const query = gql`${await fs.promises.readFile("./src/graphql/queries/externalBalance.graphql").then(b => b.toString())}`;

    try {
      const response = await client
      .query({
        query
      });

      const accounts = response.data.account.map(a => ({ address: a.address, balance: a.balance, peer_address: peer.address }))
      if (accounts.length === 0) {
        continue;
      }

      await insertExternalBalance(workerConnection, accounts);
    } catch (e) {
      logger.error(`Error occurred while querying bundler peer: ${e}`);
    }
  }
}
