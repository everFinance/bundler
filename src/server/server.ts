import { router } from "./router";
import Koa from "koa";
import koaLogger from "koa-logger";
import logger from "../logger";
import serverAdapter from "../queues/queueServer";
import { setupGql } from "../graphql/gqlServer";
import * as Sentry from "@sentry/node";
import * as domain from "domain";
import { extractTraceparentData, stripUrlQueryAndFragment } from "@sentry/tracing";
import * as fs from "fs";
import websockify from "koa-websocket";
// import { setupWs } from "./ws/wsServer";
import cors from "@koa/cors";
import gracefulShutdown from "http-graceful-shutdown";
import { sleep } from "../utils/utils";

function getGitCommit(): string {
  const rev = fs.readFileSync(".git/HEAD").toString().trim();
  if (rev.indexOf(":") === -1) {
    return rev;
  } else {
    return fs.readFileSync(".git/" + rev.substring(5)).toString().trim();
  }
}

let server;

export async function runServer(): Promise<void> {
  const gqlServer = setupGql();
  const app = websockify(new Koa());
  app.use(koaLogger(((str) => {
    logger.info(str);
  })));


  if (process.env.SEND_STATISTICS) {
    logger.info("Starting with statistics");

    Sentry.init({
      dsn: "https://66743ff5ba924b5da121907b2e4ae15b@o939367.ingest.sentry.io/5889310",
      release: "node@" + getGitCommit(),
      initialScope: {
        // user: { id: ARWEAVE_ADDRESS }
      },
      tracesSampleRate: 1.0
    });



    app.on("error", (err, ctx) => {
      Sentry.withScope(function (scope) {
        scope.addEventProcessor(function (event) {
          return Sentry.Handlers.parseRequest(event, ctx.request);
        });
        Sentry.captureException(err);
      });
    });
    app.use(requestHandler);
    app.use(tracingMiddleWare);

  }
  await gqlServer.start()
  app.use(gqlServer.getMiddleware());

  app.use(serverAdapter.registerPlugin());

  app.use(cors())

  app.use(router.routes());


  const port = process.env.PORT!;
  server = app.listen(port);
  logger.info(`Listening on port ${port}`);
  gracefulShutdown(server,
    {
      timeout: 300000,
      forceExit: false,
      preShutdown: async (_) => await sleep(5000) as void,
      onShutdown: onHTTPShutdown,
      finally: () => { logger.info("HTTP server shutdown complete") }
    });

  if (process.env.SOLANA === "true") {
    // setupWs(app);
  }
}

async function onHTTPShutdown(signal) {
  logger.debug(`Received signal ${signal}`);
  //insert cleanup operation(s) here
  return;
}

const requestHandler = (ctx, next) => {
  return new Promise<void>((resolve, _) => {
    const local = domain.create();
    local.add(ctx);
    local.on("error", err => {
      ctx.status = err.status || 500;
      ctx.body = err.message;
      ctx.app.emit("error", err, ctx);
    });
    local.run(async () => {
      Sentry.getCurrentHub().configureScope(scope =>
        scope.addEventProcessor(event =>
          Sentry.Handlers.parseRequest(event, ctx.request, { user: false })
        )
      );
      await next();
      resolve();
    });
  });
};


// this tracing middleware creates a transaction per request
const tracingMiddleWare = async (ctx, next) => {
  const reqMethod = (ctx.method || "").toUpperCase();
  const reqUrl = ctx.url && stripUrlQueryAndFragment(ctx.url);

  // connect to trace of upstream app
  let traceparentData;
  if (ctx.request.get("sentry-trace")) {
    traceparentData = extractTraceparentData(ctx.request.get("sentry-trace"));
  }

  const transaction = Sentry.startTransaction({
    name: `${reqMethod} ${reqUrl}`,
    op: "http.server",
    ...traceparentData,
  });

  ctx.__sentry_transaction = transaction;

  // We put the transaction on the scope so users can attach children to it
  Sentry.getCurrentHub().configureScope(scope => {
    scope.setSpan(transaction);
  });

  ctx.res.on("finish", () => {
    // Push `transaction.finish` to the next event loop so open spans have a chance to finish before the transaction closes
    setImmediate(() => {
      // if using koa router, a nicer way to capture transaction using the matched route
      if (ctx._matchedRoute) {
        const mountPath = ctx.mountPath || "";
        transaction.setName(`${reqMethod} ${mountPath}${ctx._matchedRoute}`);
      }
      transaction.setHttpStatus(ctx.status);
      transaction.finish();
    });
  });

  await next();
};
