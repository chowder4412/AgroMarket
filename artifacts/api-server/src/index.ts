import app from "./app";
import { logger } from "./lib/logger";
import { expireStalePaystackPayments } from "./lib/paystack";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

const paymentExpiryTimer = setInterval(() => {
  void expireStalePaystackPayments().catch((error: unknown) => {
    logger.error({ err: error }, "Could not reconcile expired Paystack payments");
  });
}, 60_000);
paymentExpiryTimer.unref();
