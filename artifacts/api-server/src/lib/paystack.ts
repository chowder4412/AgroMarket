import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import {
  checkoutPaymentsTable,
  db,
  inventoryTable,
  orderItemsTable,
  ordersTable,
  paymentWebhookEventsTable,
  paymentsTable,
} from "@workspace/db";

const PAYSTACK_API = "https://api.paystack.co";
const RESERVATION_MINUTES = 15;

export interface PaystackTransaction {
  id: string | number;
  status: string;
  reference: string;
  amount: number;
  currency: string;
}

function paystackSecret(): string | null {
  const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
  return secret || null;
}

async function parseProviderResponse(response: Response): Promise<Record<string, unknown>> {
  const payload = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!response.ok || payload?.status !== true) {
    throw new Error("Paystack could not confirm the payment request.");
  }
  return payload;
}

export async function initializePaystackTransaction(input: {
  email: string;
  amountNgn: number;
  reference: string;
  orderGroupNumber: string;
}): Promise<{ authorizationUrl: string; reference: string }> {
  const secret = paystackSecret();
  if (!secret) throw new Error("Paystack is not configured.");
  const amountKobo = input.amountNgn * 100;
  if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0) {
    throw new Error("The checkout total is outside the supported range.");
  }

  const callbackUrl = process.env.PAYSTACK_CALLBACK_URL?.trim();
  const response = await fetch(`${PAYSTACK_API}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: input.email,
      amount: String(amountKobo),
      currency: "NGN",
      reference: input.reference,
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
      metadata: JSON.stringify({ orderGroupNumber: input.orderGroupNumber }),
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await parseProviderResponse(response);
  const data = payload.data as Record<string, unknown> | undefined;
  const authorizationUrl = data?.authorization_url;
  const reference = data?.reference;
  if (
    typeof authorizationUrl !== "string" ||
    !authorizationUrl.startsWith("https://checkout.paystack.com/") ||
    reference !== input.reference
  ) {
    throw new Error("Paystack returned an invalid checkout response.");
  }
  return { authorizationUrl, reference };
}

export async function verifyPaystackTransaction(
  reference: string,
): Promise<PaystackTransaction> {
  const secret = paystackSecret();
  if (!secret) throw new Error("Paystack is not configured.");
  const response = await fetch(
    `${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(12_000),
    },
  );
  const payload = await parseProviderResponse(response);
  const data = payload.data as Record<string, unknown> | undefined;
  if (
    !data ||
    (typeof data.id !== "number" && typeof data.id !== "string") ||
    typeof data.status !== "string" ||
    typeof data.reference !== "string" ||
    typeof data.amount !== "number" ||
    typeof data.currency !== "string"
  ) {
    throw new Error("Paystack returned an incomplete verification response.");
  }
  return {
    id: data.id,
    status: data.status,
    reference: data.reference,
    amount: data.amount,
    currency: data.currency,
  };
}

export function verifyPaystackSignature(
  rawBody: Buffer | undefined,
  signature: string | undefined,
): boolean {
  const secret = paystackSecret();
  if (!secret || !rawBody || !signature || !/^[a-f0-9]{128}$/i.test(signature)) {
    return false;
  }
  const expected = createHmac("sha512", secret).update(rawBody).digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function matchesExpectedPayment(
  expected: { reference: string; amountNgn: number },
  transaction: PaystackTransaction,
): boolean {
  return (
    transaction.reference === expected.reference &&
    transaction.currency === "NGN" &&
    transaction.amount === expected.amountNgn * 100
  );
}

async function updatePaymentGroup(
  reference: string,
  eventId: string,
  nextStatus: "paid" | "failed",
) {
  return db.transaction(async (tx) => {
    const [group] = await tx
      .select()
      .from(checkoutPaymentsTable)
      .where(eq(checkoutPaymentsTable.providerReference, reference))
      .limit(1);
    if (!group) return null;

    const [event] = await tx
      .insert(paymentWebhookEventsTable)
      .values({
        providerEventId: `paystack:${eventId}`,
        provider: "paystack",
      })
      .onConflictDoNothing()
      .returning({ id: paymentWebhookEventsTable.id });
    if (!event) {
      return {
        status: group.status,
        orderGroupNumber: group.orderGroupNumber,
        amountNgn: group.amountNgn,
      };
    }

    const [claimed] = await tx
      .update(checkoutPaymentsTable)
      .set({
        status: nextStatus,
        paidAt: nextStatus === "paid" ? new Date() : null,
      })
      .where(
        and(
          eq(checkoutPaymentsTable.id, group.id),
          eq(checkoutPaymentsTable.status, "pending"),
        ),
      )
      .returning({ id: checkoutPaymentsTable.id });
    if (!claimed) {
      return {
        status: group.status,
        orderGroupNumber: group.orderGroupNumber,
        amountNgn: group.amountNgn,
      };
    }

    const groupOrders = await tx
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(eq(ordersTable.orderGroupNumber, group.orderGroupNumber));
    const orderIds = groupOrders.map((order) => order.id);
    const lines = orderIds.length
      ? await tx
          .select({
            productId: orderItemsTable.productId,
            quantity: orderItemsTable.quantity,
          })
          .from(orderItemsTable)
          .where(inArray(orderItemsTable.orderId, orderIds))
      : [];
    const reservedByProduct = new Map<number, number>();
    for (const line of lines) {
      reservedByProduct.set(
        line.productId,
        (reservedByProduct.get(line.productId) ?? 0) + line.quantity,
      );
    }

    for (const [productId, quantity] of reservedByProduct) {
      const [inventory] = await tx
        .update(inventoryTable)
        .set(
          nextStatus === "paid"
            ? {
                quantity: sql`${inventoryTable.quantity} - ${quantity}`,
                reserved: sql`${inventoryTable.reserved} - ${quantity}`,
              }
            : { reserved: sql`${inventoryTable.reserved} - ${quantity}` },
        )
        .where(
          and(
            eq(inventoryTable.productId, productId),
            sql`${inventoryTable.reserved} >= ${quantity}`,
            ...(nextStatus === "paid"
              ? [sql`${inventoryTable.quantity} >= ${quantity}`]
              : []),
          ),
        )
        .returning({ productId: inventoryTable.productId });
      if (!inventory) {
        throw new Error("Reserved inventory could not be reconciled.");
      }
    }

    if (orderIds.length) {
      await tx
        .update(ordersTable)
        .set({
          status: nextStatus === "paid" ? "paid" : "cancelled",
          paymentStatus: nextStatus,
        })
        .where(inArray(ordersTable.id, orderIds));
      await tx
        .update(paymentsTable)
        .set({ status: nextStatus })
        .where(inArray(paymentsTable.orderId, orderIds));
    }
    return {
      status: nextStatus,
      orderGroupNumber: group.orderGroupNumber,
      amountNgn: group.amountNgn,
    };
  });
}

export async function markPaystackPaymentPaid(
  reference: string,
  transactionId: string,
) {
  return updatePaymentGroup(reference, transactionId, "paid");
}

export async function markPaystackPaymentFailed(
  reference: string,
  transactionId: string,
) {
  return updatePaymentGroup(reference, transactionId, "failed");
}

export async function expireStalePaystackPayments(): Promise<void> {
  if (!paystackSecret()) return;
  const expired = await db
    .select({
      reference: checkoutPaymentsTable.providerReference,
      amountNgn: checkoutPaymentsTable.amountNgn,
    })
    .from(checkoutPaymentsTable)
    .where(
      and(
        eq(checkoutPaymentsTable.provider, "paystack"),
        eq(checkoutPaymentsTable.status, "pending"),
        lt(checkoutPaymentsTable.expiresAt, new Date()),
      ),
    )
    .limit(20);

  for (const payment of expired) {
    try {
      const transaction = await verifyPaystackTransaction(payment.reference);
      const transactionId = String(transaction.id);
      if (
        transaction.status === "success" &&
        matchesExpectedPayment(payment, transaction)
      ) {
        await markPaystackPaymentPaid(payment.reference, transactionId);
      } else if (
        ["failed", "abandoned", "reversed"].includes(transaction.status)
      ) {
        await markPaystackPaymentFailed(payment.reference, transactionId);
      } else {
        await db
          .update(checkoutPaymentsTable)
          .set({
            expiresAt: new Date(Date.now() + RESERVATION_MINUTES * 60_000),
          })
          .where(
            and(
              eq(checkoutPaymentsTable.providerReference, payment.reference),
              eq(checkoutPaymentsTable.status, "pending"),
            ),
          );
      }
    } catch {
      await db
        .update(checkoutPaymentsTable)
        .set({
          expiresAt: new Date(Date.now() + RESERVATION_MINUTES * 60_000),
        })
        .where(
          and(
            eq(checkoutPaymentsTable.providerReference, payment.reference),
            eq(checkoutPaymentsTable.status, "pending"),
          ),
        );
    }
  }
}
