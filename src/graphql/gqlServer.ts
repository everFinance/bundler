import { ApolloServer } from "apollo-server-koa";
import BundlerAPI from "./datasource";
import * as fs from "fs";
import BigInt from "apollo-type-bigint";
import { createRateLimitDirective, createRateLimitTypeDef } from "graphql-rate-limit-directive";
import { httpServerConnection } from "../database/httpServerConnection.database";

export function setupGql(): ApolloServer {
  const typeDefs = fs.readFileSync("./src/graphql/schema.graphql").toString();
  const resolvers = {
    Query: {
      transaction: async (_, { ids, after }, { dataSources }) => {
        return await dataSources.db.getDataItems(ids, after);
      },
      account: async (_, { allowExternal, addresses }, { dataSources }) => {
        return await dataSources.db.getBalances(allowExternal, addresses);
      },
    },
    BigInt: new BigInt("safe"),
  };

  // IMPORTANT: Specify how a rate limited field should determine uniqueness/isolation of operations
  // Uses the combination of user specific data (their ip) along the type and field being accessed
  const keyGenerator = (_, __, ___, context) => {
    return `${context.ip}`;
  };

  const db = new BundlerAPI(httpServerConnection);
  return new ApolloServer({
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    typeDefs: [createRateLimitTypeDef(), typeDefs],
    resolvers,
    dataSources: () => ({ db }),
    schemaDirectives: {
      rateLimit: createRateLimitDirective({
        keyGenerator
      }),
    },
  });
}


