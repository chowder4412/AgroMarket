export type OrderDisputeStatus = "open" | "reviewing" | "resolved" | "rejected";

const allowedTransitions: Record<OrderDisputeStatus, OrderDisputeStatus[]> = {
  open: ["reviewing"],
  reviewing: ["reviewing", "resolved", "rejected"],
  resolved: [],
  rejected: [],
};

export function canTransitionDispute(
  current: OrderDisputeStatus,
  next: OrderDisputeStatus,
): boolean {
  return allowedTransitions[current].includes(next);
}