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

import { action } from "./courses.$slug.refund";

let base: ReturnType<typeof seedBaseData>;

function postRefundRequest() {
  const body = new FormData();
  body.set("reason", "The course was not what I expected.");
  const request = new Request(
    `http://localhost/courses/${base.course.slug}/refund`,
    { method: "POST", body }
  );

  return action({
    request,
    params: { slug: base.course.slug },
    context: {},
  } as Parameters<typeof action>[0]);
}

async function rejectionOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (thrown) {
    const { data, init } = thrown as { data: unknown; init?: ResponseInit };
    return { message: data, status: init?.status };
  }
  throw new Error("Expected the action to reject the Refund Request");
}

describe("refund action", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    currentUserId = base.user.id;
  });

  it("rejects a direct POST from a learner who has completed 50% of the lessons", async () => {
    testDb
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 4900,
      })
      .run();
    const mod = testDb
      .insert(schema.modules)
      .values({ courseId: base.course.id, title: "Module", position: 1 })
      .returning()
      .get();
    const [completed] = [1, 2].map((position) =>
      testDb
        .insert(schema.lessons)
        .values({ moduleId: mod.id, title: `Lesson ${position}`, position })
        .returning()
        .get()
    );
    testDb
      .insert(schema.lessonProgress)
      .values({
        userId: base.user.id,
        lessonId: completed.id,
        status: schema.LessonProgressStatus.Completed,
      })
      .run();

    expect(await rejectionOf(postRefundRequest())).toEqual({
      message: "You have completed too many lessons of this course to cancel it.",
      status: 403,
    });
    expect(testDb.select().from(schema.refunds).all()).toEqual([]);
  });
});
