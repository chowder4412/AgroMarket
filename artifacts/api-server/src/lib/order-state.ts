export type SellerOrderStatus =
  | "pending_payment"
  | "paid"
  | "processing"
  | "in_transit"
  | "delivered"
  | "cancelled";

const allowedSellerTransitions: Record<
  SellerOrderStatus,
  readonly SellerOrderStatus[]
> = {
  pending_payment: [],
  paid: ["processing"],
  processing: ["in_transit"],
  in_transit: ["delivered"],
  delivered: [],
  cancelled: [],
};

export function canSellerTransitionOrder(
  current: SellerOrderStatus,
  next: SellerOrderStatus,
): boolean {
  return allowedSellerTransitions[current].includes(next);
}