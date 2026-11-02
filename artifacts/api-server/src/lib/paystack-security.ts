import { createHmac, timingSafeEqual } from "node:crypto";

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

export function isPaystackConfigured(): boolean {
  return isPaystackSecretConfigured() && paystackPublicKey() !== null;
}

export function isPaystackSecretConfigured(): boolean {
  return paystackSecret() !== null;
}

export function paystackPublicKey(): string | null {
  const key = process.env.PAYSTACK_PUBLIC_KEY?.trim();
  return key || null;
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

export function matchesExpectedPayment(
  expected: { reference: string; amountNgn: number },
  transaction: PaystackTransaction,
): boolean {
  return (
    transaction.reference === expected.reference &&
    transaction.currency === "NGN" &&
    transaction.amount === expected.amountNgn * 100
  );
}