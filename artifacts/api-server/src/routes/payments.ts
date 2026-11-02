import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  checkoutPaymentsTable,
  db,
  ordersTable,
} from "@workspace/db";
import {
  GetPaymentMethodsResponse,
  GetPaystackPaymentSessionParams,
  GetPaystackPaymentSessionResponse,
  VerifyPaystackPaymentBody,
  VerifyPaystackPaymentResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import {
  isPaystackConfigured,
  isPaystackSecretConfigured,
  markPaystackPaymentFailed,
  markPaystackPaymentPaid,
  matchesExpectedPayment,
  paystackPublicKey,
  verifyPaystackSignature,
  verifyPaystackTransaction,
} from "../lib/paystack";
import { orderPayload } from "./commerce";

const router: IRouter = Router();

router.get("/payments/methods", (_req, res): void => {
  res.json(
    GetPaymentMethodsResponse.parse({
      paystackAvailable: isPaystackConfigured(),
      paystackPublicKey: paystackPublicKey(),
    }),
  );
});

router.get(
  "/orders/:id/payment-session",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = GetPaystackPaymentSessionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [order] = await db
      .select({ id: ordersTable.id, group: ordersTable.orderGroupNumber })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.id, params.data.id),
          eq(ordersTable.buyerId, req.marketplaceUserId!),
          eq(ordersTable.paymentStatus, "pending"),
          eq(ordersTable.paymentMode, "provider_pending"),
        ),
      )
      .limit(1);
    if (!order?.group) {
      res.status(404).json({ error: "Pending Paystack order not found." });
      return;
    }
    const [session] = await db
      .select()
      .from(checkoutPaymentsTable)
      .where(
        and(
          eq(checkoutPaymentsTable.orderGroupNumber, order.group),
          eq(checkoutPaymentsTable.buyerId, req.marketplaceUserId!),
          eq(checkoutPaymentsTable.provider, "paystack"),
          eq(checkoutPaymentsTable.status, "pending"),
        ),
      )
      .limit(1);
    if (!session) {
      res.status(404).json({ error: "Pending Paystack session not found." });
      return;
    }
    if (session.expiresAt <= new Date() || !session.accessCode) {
      res.status(409).json({ error: "Paystack session expired or is not ready to resume." });
      return;
    }
    res.json(
      GetPaystackPaymentSessionResponse.parse({
        accessCode: session.accessCode,
        reference: session.providerReference,
        orderGroupNumber: session.orderGroupNumber,
        grandTotal: session.amountNgn,
      }),
    );
  },
);

router.post(
  "/payments/paystack/verify",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = VerifyPaystackPaymentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (!isPaystackSecretConfigured()) {
      res.status(503).json({ error: "Paystack is not configured." });
      return;
    }

    const [payment] = await db
      .select()
      .from(checkoutPaymentsTable)
      .where(eq(checkoutPaymentsTable.providerReference, parsed.data.reference))
      .limit(1);
    if (!payment || payment.buyerId !== req.marketplaceUserId) {
      res.status(404).json({ error: "Payment reference not found." });
      return;
    }

    const transaction = await verifyPaystackTransaction(payment.providerReference);
    if (
      !matchesExpectedPayment(
        { reference: payment.providerReference, amountNgn: payment.amountNgn },
        transaction,
      )
    ) {
      res.status(409).json({ error: "Payment details do not match this order." });
      return;
    }
    if (transaction.status === "success") {
      await markPaystackPaymentPaid(payment.providerReference, String(transaction.id));
    } else if (["failed", "abandoned", "reversed"].includes(transaction.status)) {
      await markPaystackPaymentFailed(payment.providerReference, String(transaction.id));
    }

    const [current] = await db
      .select()
      .from(checkoutPaymentsTable)
      .where(eq(checkoutPaymentsTable.id, payment.id))
      .limit(1);
    const orderRows = await db
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(eq(ordersTable.orderGroupNumber, payment.orderGroupNumber));
    const orders = await Promise.all(orderRows.map(({ id }) => orderPayload(id)));
    res.json(
      VerifyPaystackPaymentResponse.parse({
        reference: payment.providerReference,
        status: current?.status ?? payment.status,
        orderGroupNumber: payment.orderGroupNumber,
        grandTotal: payment.amountNgn,
        orders: orders.filter((order) => order !== null),
      }),
    );
  },
);

router.post("/payments/paystack/webhook", async (req, res): Promise<void> => {
  if (!isPaystackSecretConfigured()) {
    res.status(503).json({ error: "Paystack is not configured." });
    return;
  }
  const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
  const signature = req.header("x-paystack-signature");
  if (!verifyPaystackSignature(rawBody, signature)) {
    res.status(401).json({ error: "Invalid webhook signature." });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody!.toString("utf8"));
  } catch {
    res.status(400).json({ error: "Invalid webhook payload." });
    return;
  }
  if (!payload || typeof payload !== "object") {
    res.status(400).json({ error: "Invalid webhook payload." });
    return;
  }
  const event = payload as {
    event?: unknown;
    data?: { id?: unknown; reference?: unknown };
  };
  if (event.event !== "charge.success" && event.event !== "charge.failed") {
    res.status(200).json({ received: true });
    return;
  }
  const reference = event.data?.reference;
  const transactionId = event.data?.id;
  if (
    typeof reference !== "string" ||
    (typeof transactionId !== "string" && typeof transactionId !== "number")
  ) {
    res.status(400).json({ error: "Webhook transaction details are incomplete." });
    return;
  }

  const [payment] = await db
    .select()
    .from(checkoutPaymentsTable)
    .where(eq(checkoutPaymentsTable.providerReference, reference))
    .limit(1);
  if (!payment) {
    res.status(200).json({ received: true });
    return;
  }

  const transaction = await verifyPaystackTransaction(reference);
  if (
    !matchesExpectedPayment(
      { reference: payment.providerReference, amountNgn: payment.amountNgn },
      transaction,
    )
  ) {
    res.status(400).json({ error: "Webhook payment details do not match the order." });
    return;
  }
  if (event.event === "charge.success" && transaction.status === "success") {
    await markPaystackPaymentPaid(reference, String(transaction.id));
  } else if (
    event.event === "charge.failed" &&
    ["failed", "abandoned", "reversed"].includes(transaction.status)
  ) {
    await markPaystackPaymentFailed(reference, String(transaction.id));
  }
  res.status(200).json({ received: true });
});

export default router;