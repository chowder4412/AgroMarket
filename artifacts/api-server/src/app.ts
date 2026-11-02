import express, { type Express, type Request } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      callback(
        null,
        !origin ||
          process.env.NODE_ENV !== "production" ||
          allowedOrigins.has(origin),
      );
    },
  }),
);
app.use(
  express.json({
    verify: (req, _res, body) => {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(body);
    },
  }),
);
app.use(express.urlencoded({ extended: true }));
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);
app.use((error: unknown, _req: Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err: error }, "Unhandled API request error");
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error." });
  }
});

export default app;
