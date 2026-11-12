import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  lessonProgress,
  lessons,
  modules,
  purchases,
  refunds,
  videoWatchEvents,
  LessonProgressStatus,
  RefundStatus,
} from "~/db/schema";

export const REFUND_WINDOW_DAYS = 14;
const WATCH_LIMIT_SECONDS = 2 * 60 * 60;
const COMPLETION_LIMIT = 0.5;

// The Refund Window is counted in whole days, not hours — someone who buys at
// 23:00 should still get the whole of their fourteenth day.
function calendarDay(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}

function getLatestPurchase(userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .orderBy(sql`${purchases.createdAt} desc`)
    .get();
}

// A purchase can have only one Requested Refund Request at a time.
function hasRequestedRefundRequest(purchaseId: number) {
  const requested = db
    .select({ id: refunds.id })
    .from(refunds)
    .where(
      and(
        eq(refunds.purchaseId, purchaseId),
        eq(refunds.status, RefundStatus.Requested)
      )
    )
    .get();

  return requested !== undefined;
}

function getLessonIdsForCourse(courseId: number): number[] {
  return db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);
}

function getCompletedLessonCount(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(lessonProgress.lessonId, lessonIds)
      )
    )
    .get();

  return result?.count ?? 0;
}

// Only the furthest position reached in each lesson counts, so rewatching a
// lesson does not use up the allowance twice.
function getSecondsWatched(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  const furthestPerLesson = db
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all();

  return furthestPerLesson.reduce((total, row) => total + row.furthest, 0);
}

// A seat that came out of a team licence, and has been claimed, belongs to the
// team — the learner cannot hand it back on their own.
function hasClaimedTeamSeat(purchaseId: number) {
  const claimedSeat = db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(eq(coupons.purchaseId, purchaseId), isNotNull(coupons.redeemedAt))
    )
    .get();

  return claimedSeat !== undefined;
}

export type RefundIneligibleReason =
  | "no-purchase"
  | "refund-request-requested"
  | "claimed-team-seat"
  | "outside-refund-window"
  | "watch-limit"
  | "completion-limit";

export type RefundEligibility =
  | {
      eligible: true;
      purchase: typeof purchases.$inferSelect;
      lastDayOfRefundWindow: string;
      refundableAmount: number;
    }
  | { eligible: false; reason: RefundIneligibleReason };

function ineligible(reason: RefundIneligibleReason): RefundEligibility {
  return { eligible: false, reason };
}

// The rules are checked in the order the refund action has always reported
// them, so a purchase that breaks several still gets the same message.
export function getRefundEligibility(
  userId: number,
  courseId: number,
  now: Date = new Date()
): RefundEligibility {
  const purchase = getLatestPurchase(userId, courseId);

  if (!purchase) return ineligible("no-purchase");
  if (hasRequestedRefundRequest(purchase.id)) {
    return ineligible("refund-request-requested");
  }
  if (hasClaimedTeamSeat(purchase.id)) return ineligible("claimed-team-seat");

  const windowEnd = new Date(purchase.createdAt);
  windowEnd.setDate(windowEnd.getDate() + REFUND_WINDOW_DAYS);
  const lastDayOfRefundWindow = calendarDay(windowEnd);
  const today = calendarDay(now);
  const withinRefundWindow =
    today >= calendarDay(new Date(purchase.createdAt)) &&
    today <= lastDayOfRefundWindow;

  if (!withinRefundWindow) return ineligible("outside-refund-window");

  const lessonIds = getLessonIdsForCourse(courseId);

  if (getSecondsWatched(userId, lessonIds) >= WATCH_LIMIT_SECONDS) {
    return ineligible("watch-limit");
  }

  if (
    lessonIds.length > 0 &&
    getCompletedLessonCount(userId, lessonIds) / lessonIds.length >=
      COMPLETION_LIMIT
  ) {
    return ineligible("completion-limit");
  }

  // The Refundable Amount is always exactly what was paid for the purchase.
  return {
    eligible: true,
    purchase,
    lastDayOfRefundWindow,
    refundableAmount: purchase.amountPaid,
  };
}
