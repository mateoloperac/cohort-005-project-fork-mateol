import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  lessonProgress,
  lessons,
  LessonProgressStatus,
  modules,
  purchases,
  refunds,
  RefundStatus,
  videoWatchEvents,
} from "~/db/schema";
import {
  decideRefundEligibility,
  type RefundIneligibleReason,
} from "~/lib/refunds";

export type RefundEligibility =
  | {
      eligible: true;
      purchaseId: number;
      amount: number;
      lastDayInWindow: string;
    }
  | { eligible: false; reason: RefundIneligibleReason | "no-purchase" };

function getLatestPurchase(userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .orderBy(sql`${purchases.createdAt} desc`)
    .get();
}

function hasRequestedRefund(purchaseId: number) {
  const row = db
    .select({ id: refunds.id })
    .from(refunds)
    .where(
      and(
        eq(refunds.purchaseId, purchaseId),
        eq(refunds.status, RefundStatus.Requested)
      )
    )
    .get();

  return row !== undefined;
}

function isClaimedTeamSeat(purchaseId: number) {
  const row = db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(eq(coupons.purchaseId, purchaseId), isNotNull(coupons.redeemedAt))
    )
    .get();

  return row !== undefined;
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

/**
 * Refund eligibility for the learner's latest Purchase of a course. The page
 * uses it to decide whether to offer a Refund; the action uses it to decide
 * whether to accept one — both must agree.
 */
export function getRefundEligibility(
  userId: number,
  courseId: number,
  today: Date = new Date()
): RefundEligibility {
  const purchase = getLatestPurchase(userId, courseId);

  if (!purchase) return { eligible: false, reason: "no-purchase" };

  const lessonIds = getLessonIdsForCourse(courseId);

  const decision = decideRefundEligibility(
    {
      purchase,
      hasRequestedRefund: hasRequestedRefund(purchase.id),
      isClaimedTeamSeat: isClaimedTeamSeat(purchase.id),
      secondsWatched: getSecondsWatched(userId, lessonIds),
      completedLessonCount: getCompletedLessonCount(userId, lessonIds),
      lessonCount: lessonIds.length,
    },
    today
  );

  if (!decision.eligible) return decision;

  return { ...decision, purchaseId: purchase.id };
}
