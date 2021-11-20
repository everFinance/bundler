import { createLogger, format, transports } from "winston";

const { combine, timestamp, label, printf } = format;

const myFormat = printf(({ level, message, label, timestamp }) => {
  return `${timestamp} [${label}] ${level}: ${message}`;
});

const logger = createLogger({
  // TODO: Update default level to `info`
  level: process.env.LOG_LEVEL ?? "debug",
  format: combine(
    label({ label: "Bundler Node" }),
    timestamp(),
    format.cli(),
    myFormat,
  ),
  transports: [
    new transports.Console(),
    //
    // - Write all logs with level `error` and below to `error.log`
    // - Write all logs with level `info` and below to `combined.log`
    //
    new transports.File({ filename: "error.log", level: "error", options: { json: true } }),
    new transports.File({ filename: "combined.log" }),
  ],
});

logger.info.bind(logger);
logger.verbose.bind(logger);
logger.error.bind(logger);
logger.debug.bind(logger);

export default logger;
