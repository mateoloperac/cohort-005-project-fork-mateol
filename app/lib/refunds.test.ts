import { describe, it, expect } from "vitest";
import {
  decideRefundEligibility,
  REFUND_WATCH_LIMIT_SECONDS,
  type RefundFacts,
} from "./refunds";

const purchasedAt = new Date(2026, 0, 1, 23, 0, 0);

function facts(overrides: Partial<RefundFacts> = {}): RefundFacts {
  return {
    purchase: { createdAt: purchasedAt.toISOString(), amountPaid: 4900 },
    hasRequestedRefund: false,
    isClaimedTeamSeat: false,
    secondsWatched: 0,
    completedLessonCount: 0,
    lessonCount: 10,
    ...overrides,
  };
}

const dayAfterPurchase = new Date(2026, 0, 2, 12, 0, 0);

describe("decideRefundEligibility", () => {
  it("offers a Refund for what the learner paid", () => {
    expect(decideRefundEligibility(facts(), dayAfterPurchase)).toEqual({
      eligible: true,
      amount: 4900,
      lastDayInWindow: "2026-01-15",
    });
  });

  it("counts the whole fourteenth day inside the Refund window", () => {
    const lateOnDayFourteen = new Date(2026, 0, 15, 23, 59, 0);
    expect(decideRefundEligibility(facts(), lateOnDayFourteen).eligible).toBe(
      true
    );
  });

  it("closes the Refund window the day after", () => {
    const dayFifteen = new Date(2026, 0, 16, 0, 1, 0);
    expect(decideRefundEligibility(facts(), dayFifteen)).toEqual({
      eligible: false,
      reason: "window-closed",
    });
  });

  it("refuses a second Refund while one is Requested", () => {
    expect(
      decideRefundEligibility(
        facts({ hasRequestedRefund: true }),
        dayAfterPurchase
      )
    ).toEqual({ eligible: false, reason: "refund-already-requested" });
  });

  it("refuses a claimed team seat", () => {
    expect(
      decideRefundEligibility(
        facts({ isClaimedTeamSeat: true }),
        dayAfterPurchase
      )
    ).toEqual({ eligible: false, reason: "claimed-team-seat" });
  });

  it("refuses once two hours of video are watched", () => {
    expect(
      decideRefundEligibility(
        facts({ secondsWatched: REFUND_WATCH_LIMIT_SECONDS }),
        dayAfterPurchase
      )
    ).toEqual({ eligible: false, reason: "watched-too-much" });
  });

  it("refuses once half the lessons are completed", () => {
    expect(
      decideRefundEligibility(
        facts({ completedLessonCount: 5, lessonCount: 10 }),
        dayAfterPurchase
      )
    ).toEqual({ eligible: false, reason: "completed-too-much" });
  });

  it("allows just under half the lessons completed", () => {
    expect(
      decideRefundEligibility(
        facts({ completedLessonCount: 4, lessonCount: 10 }),
        dayAfterPurchase
      ).eligible
    ).toBe(true);
  });

  it("allows a course with no lessons", () => {
    expect(
      decideRefundEligibility(facts({ lessonCount: 0 }), dayAfterPurchase)
        .eligible
    ).toBe(true);
  });
});
