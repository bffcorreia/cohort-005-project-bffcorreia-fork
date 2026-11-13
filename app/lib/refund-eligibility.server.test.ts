import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { eq } from "drizzle-orm";

let testDb: ReturnType<typeof createTestDb>;
vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import { getRefundEligibility } from "./refund-eligibility.server";

let base: ReturnType<typeof seedBaseData>;

// Noon on 1 March, local time — far from any midnight, so day arithmetic in
// the tests is unambiguous.
const PURCHASED_AT = new Date(2026, 2, 1, 12, 0, 0);

function daysAfterPurchase(days: number, hours = 12) {
  return new Date(2026, 2, 1 + days, hours, 0, 0);
}

function buy(
  createdAt = PURCHASED_AT,
  {
    amountPaid = 4900,
    country = null,
  }: { amountPaid?: number; country?: string | null } = {}
) {
  return testDb
    .insert(schema.purchases)
    .values({
      userId: base.user.id,
      courseId: base.course.id,
      amountPaid,
      country,
      createdAt: createdAt.toISOString(),
    })
    .returning()
    .get();
}

function addLessons(count: number) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module", position: 1 })
    .returning()
    .get();

  return Array.from({ length: count }, (_, i) =>
    testDb
      .insert(schema.lessons)
      .values({ moduleId: mod.id, title: `Lesson ${i + 1}`, position: i + 1 })
      .returning()
      .get()
  );
}

describe("getRefundEligibility", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("is eligible on the day of purchase with nothing watched or completed", () => {
    const purchase = buy();
    addLessons(4);

    const eligibility = getRefundEligibility(
      base.user.id,
      base.course.id,
      daysAfterPurchase(0)
    );

    expect(eligibility).toEqual({
      eligible: true,
      purchase,
      lastDayOfRefundWindow: "2026-03-15",
      refundableAmount: 4900,
    });
  });

  it("is not eligible without a purchase", () => {
    expect(
      getRefundEligibility(base.user.id, base.course.id, daysAfterPurchase(0))
    ).toEqual({ eligible: false, reason: "no-purchase" });
  });

  describe("the Refundable Amount", () => {
    function setListPrice(price: number) {
      testDb
        .update(schema.courses)
        .set({ price })
        .where(eq(schema.courses.id, base.course.id))
        .run();
    }

    function refundableAmount() {
      const eligibility = getRefundEligibility(
        base.user.id,
        base.course.id,
        daysAfterPurchase(1)
      );
      return eligibility.eligible ? eligibility.refundableAmount : null;
    }

    it("is what was paid when the purchase was below the list price", () => {
      setListPrice(7900);
      buy(PURCHASED_AT, { amountPaid: 4900, country: "US" });

      expect(refundableAmount()).toBe(4900);
    });

    it("is what was paid when the full list price was paid", () => {
      setListPrice(7900);
      buy(PURCHASED_AT, { amountPaid: 7900, country: "US" });

      expect(refundableAmount()).toBe(7900);
    });

    it("is what was paid for a purchasing-power price", () => {
      setListPrice(7900);
      buy(PURCHASED_AT, { amountPaid: 3950, country: "IN" });

      expect(refundableAmount()).toBe(3950);
    });
  });

  describe("the Refund Window", () => {
    it("still allows a Refund Request on the 14th day after the purchase day, up to midnight", () => {
      buy();

      expect(
        getRefundEligibility(
          base.user.id,
          base.course.id,
          daysAfterPurchase(14, 23)
        ).eligible
      ).toBe(true);
    });

    it("is closed on the 15th day after the purchase day", () => {
      buy();

      expect(
        getRefundEligibility(
          base.user.id,
          base.course.id,
          daysAfterPurchase(15, 0)
        )
      ).toEqual({ eligible: false, reason: "outside-refund-window" });
    });
  });

  describe("the watch limit", () => {
    // Only the furthest position reached in each lesson counts, so rewatching
    // a lesson does not use up the allowance twice.
    function watch(lessonId: number, positionSeconds: number) {
      testDb
        .insert(schema.videoWatchEvents)
        .values({
          userId: base.user.id,
          lessonId,
          eventType: "progress",
          positionSeconds,
        })
        .run();
    }

    it("is eligible with just under 2 hours watched", () => {
      buy();
      const [first, second] = addLessons(2);
      watch(first.id, 600);
      watch(first.id, 3600);
      watch(second.id, 3599);

      expect(
        getRefundEligibility(base.user.id, base.course.id, daysAfterPurchase(1))
          .eligible
      ).toBe(true);
    });

    it("is not eligible with exactly 2 hours watched", () => {
      buy();
      const [first, second] = addLessons(2);
      watch(first.id, 3600);
      watch(second.id, 3600);

      expect(
        getRefundEligibility(base.user.id, base.course.id, daysAfterPurchase(1))
      ).toEqual({ eligible: false, reason: "watch-limit" });
    });
  });

  describe("the completion limit", () => {
    function complete(lessonsToComplete: { id: number }[]) {
      for (const lesson of lessonsToComplete) {
        testDb
          .insert(schema.lessonProgress)
          .values({
            userId: base.user.id,
            lessonId: lesson.id,
            status: schema.LessonProgressStatus.Completed,
          })
          .run();
      }
    }

    it("is eligible with just under 50% of lessons completed", () => {
      buy();
      complete(addLessons(9).slice(0, 4));

      expect(
        getRefundEligibility(base.user.id, base.course.id, daysAfterPurchase(1))
          .eligible
      ).toBe(true);
    });

    it("is not eligible with exactly 50% of lessons completed", () => {
      buy();
      complete(addLessons(10).slice(0, 5));

      expect(
        getRefundEligibility(base.user.id, base.course.id, daysAfterPurchase(1))
      ).toEqual({ eligible: false, reason: "completion-limit" });
    });

    it("does not count lessons that are only in progress", () => {
      buy();
      const courseLessons = addLessons(2);
      testDb
        .insert(schema.lessonProgress)
        .values({
          userId: base.user.id,
          lessonId: courseLessons[0].id,
          status: schema.LessonProgressStatus.InProgress,
        })
        .run();

      expect(
        getRefundEligibility(base.user.id, base.course.id, daysAfterPurchase(1))
          .eligible
      ).toBe(true);
    });
  });

  describe("an existing Refund Request", () => {
    function requestRefund(purchaseId: number, status: schema.RefundStatus) {
      testDb
        .insert(schema.refunds)
        .values({ purchaseId, status, reason: "It was not what I expected." })
        .run();
    }

    it("is not eligible while a Refund Request is Requested", () => {
      const purchase = buy();
      requestRefund(purchase.id, schema.RefundStatus.Requested);

      expect(
        getRefundEligibility(base.user.id, base.course.id, daysAfterPurchase(1))
      ).toEqual({ eligible: false, reason: "refund-request-requested" });
    });

    it("is eligible again after a Refund Request was Declined", () => {
      const purchase = buy();
      requestRefund(purchase.id, schema.RefundStatus.Declined);

      expect(
        getRefundEligibility(base.user.id, base.course.id, daysAfterPurchase(1))
          .eligible
      ).toBe(true);
    });
  });

  describe("team seats", () => {
    function issueSeat(purchaseId: number, redeemedAt: string | null) {
      const team = testDb.insert(schema.teams).values({}).returning().get();
      testDb
        .insert(schema.coupons)
        .values({
          teamId: team.id,
          courseId: base.course.id,
          code: `SEAT-${purchaseId}`,
          purchaseId,
          redeemedByUserId: redeemedAt ? base.user.id : null,
          redeemedAt,
        })
        .run();
    }

    it("is not eligible once a seat from the purchase has been claimed", () => {
      const purchase = buy();
      issueSeat(purchase.id, daysAfterPurchase(1).toISOString());

      expect(
        getRefundEligibility(base.user.id, base.course.id, daysAfterPurchase(2))
      ).toEqual({ eligible: false, reason: "claimed-team-seat" });
    });

    it("is eligible while the seat is still unclaimed", () => {
      const purchase = buy();
      issueSeat(purchase.id, null);

      expect(
        getRefundEligibility(base.user.id, base.course.id, daysAfterPurchase(2))
          .eligible
      ).toBe(true);
    });
  });
});
