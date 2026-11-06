import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

process.env.PAYSTACK_SECRET_KEY = "unit-test-paystack-secret";
delete process.env.PAYSTACK_PUBLIC_KEY;
const {
  isPaystackConfigured,
  isPaystackSecretConfigured,
  matchesExpectedPayment,
  verifyPaystackSignature,
} = await import(
  "./paystack-security.ts"
);
const { canTransitionDispute } = await import("./dispute-state.ts");
const { calculateQuotationPrice } = await import("./quotation-pricing.ts");
const { canSellerTransitionOrder } = await import("./order-state.ts");

const rawBody = Buffer.from('{"event":"charge.success","data":{"id":42}}');
const signature = createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
  .update(rawBody)
  .digest("hex");

test("accepts a valid Paystack HMAC signature", () => {
  assert.equal(verifyPaystackSignature(rawBody, signature), true);
});

test("rejects a signature that does not match the raw request body", () => {
  assert.equal(
    verifyPaystackSignature(Buffer.from("different payload"), signature),
    false,
  );
});

test("rejects missing and malformed webhook signatures", () => {
  assert.equal(verifyPaystackSignature(rawBody, undefined), false);
  assert.equal(verifyPaystackSignature(rawBody, "not-a-signature"), false);
});

test("distinguishes Inline readiness from server-side payment verification readiness", () => {
  assert.equal(isPaystackSecretConfigured(), true);
  assert.equal(isPaystackConfigured(), false);
  process.env.PAYSTACK_PUBLIC_KEY = "pk_test_inline";
  assert.equal(isPaystackConfigured(), true);
  delete process.env.PAYSTACK_PUBLIC_KEY;
});

test("matches only the expected reference, NGN currency, and amount", () => {
  const expected = { reference: "AMPS-reference", amountNgn: 15_000 };
  const transaction = {
    id: 42,
    status: "success",
    reference: "AMPS-reference",
    amount: 1_500_000,
    currency: "NGN",
  };

  assert.equal(matchesExpectedPayment(expected, transaction), true);
  assert.equal(
    matchesExpectedPayment(expected, { ...transaction, reference: "other" }),
    false,
  );
  assert.equal(
    matchesExpectedPayment(expected, { ...transaction, amount: 1_499_999 }),
    false,
  );
  assert.equal(
    matchesExpectedPayment(expected, { ...transaction, currency: "USD" }),
    false,
  );
});

test("enforces the dispute review state machine", () => {
  assert.equal(canTransitionDispute("open", "reviewing"), true);
  assert.equal(canTransitionDispute("open", "resolved"), false);
  assert.equal(canTransitionDispute("reviewing", "resolved"), true);
  assert.equal(canTransitionDispute("reviewing", "rejected"), true);
  assert.equal(canTransitionDispute("resolved", "reviewing"), false);
  assert.equal(canTransitionDispute("rejected", "resolved"), false);
});

test("sellers can only advance fulfillment after payment", () => {
  assert.equal(canSellerTransitionOrder("pending_payment", "paid"), false);
  assert.equal(canSellerTransitionOrder("paid", "processing"), true);
  assert.equal(canSellerTransitionOrder("processing", "in_transit"), true);
  assert.equal(canSellerTransitionOrder("in_transit", "delivered"), true);
  assert.equal(canSellerTransitionOrder("paid", "cancelled"), false);
  assert.equal(canSellerTransitionOrder("processing", "cancelled"), false);
});

test("computes a quote total from complete per-line prices", () => {
  const result = calculateQuotationPrice(
    [
      { quotationItemId: 7, quantity: 10 },
      { quotationItemId: 8, quantity: 2 },
    ],
    [
      { quotationItemId: 7, unitPriceNgn: 1_200 },
      { quotationItemId: 8, unitPriceNgn: 8_500 },
    ],
  );

  assert.equal(result.totalNgn, 29_000);
  assert.deepEqual(result.items.map((item) => item.quantity * item.unitPriceNgn), [12_000, 17_000]);
});

test("rejects incomplete, duplicate, or unrelated quote line prices", () => {
  const request = [{ quotationItemId: 7, quantity: 10 }];
  assert.throws(() => calculateQuotationPrice(request, []));
  assert.throws(() => calculateQuotationPrice(request, [
    { quotationItemId: 7, unitPriceNgn: 1_000 },
    { quotationItemId: 7, unitPriceNgn: 1_100 },
  ]));
  assert.throws(() => calculateQuotationPrice(request, [{ quotationItemId: 99, unitPriceNgn: 1_000 }]));
});