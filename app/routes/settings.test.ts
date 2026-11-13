import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

let currentUserId: number | null = null;
vi.mock("~/lib/session", () => ({
  getCurrentUserId: vi.fn(async () => currentUserId),
}));

import { loader } from "./settings";

let base: ReturnType<typeof seedBaseData>;

function loadSettings() {
  return loader({
    request: new Request("http://localhost/settings"),
    params: {},
    context: {},
  } as Parameters<typeof loader>[0]);
}

function makeRefundRequest(status: schema.RefundStatus) {
  const purchase = testDb
    .insert(schema.purchases)
    .values({
      userId: base.user.id,
      courseId: base.course.id,
      amountPaid: 4900,
    })
    .returning()
    .get();
  testDb
    .insert(schema.refunds)
    .values({ purchaseId: purchase.id, status, reason: "Not what I expected." })
    .run();
}

describe("settings loader", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    currentUserId = base.user.id;
  });

  it("lists the learner's Requested Refund Requests but not Resolved ones", async () => {
    makeRefundRequest(schema.RefundStatus.Requested);
    makeRefundRequest(schema.RefundStatus.Declined);

    const { requestedRefundRequests } = await loadSettings();

    expect(requestedRefundRequests).toEqual([
      expect.objectContaining({
        courseTitle: "Test Course",
        refundableAmount: 4900,
        reason: "Not what I expected.",
      }),
    ]);
  });
});
