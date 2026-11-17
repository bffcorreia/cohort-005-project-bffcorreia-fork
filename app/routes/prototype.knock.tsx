// PROTOTYPE — throwaway Knock spike for "Does Knock hold up against Cadence?".
// Runs the four checks live against Knock for whichever user the DevUI selects.
// Lives on the prototype/knock-spike branch only. Never merge.
import { useCallback, useEffect, useState } from "react";
import { data, Form, useActionData } from "react-router";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { Route } from "./+types/prototype.knock";
import { db } from "~/db";
import { comments, courses, lessons, modules, users } from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";
import {
  knock,
  knockConfig,
  knockUserId,
  signTokenFor,
} from "~/lib/prototype-knock.server";

const ENROLLMENT_CATEGORY = "new-enrollment";

function recipientFor(user: { id: number; name: string; email: string }) {
  return { id: knockUserId(user.id), name: user.name, email: user.email };
}

// A Discussion Question (top-level comment) the current user didn't write, so
// "replying" to it notifies someone else.
function findQuestion(currentUserId: number) {
  return db
    .select({
      id: comments.id,
      body: comments.body,
      lessonTitle: lessons.title,
      courseSlug: courses.slug,
      authorId: users.id,
      authorName: users.name,
      authorEmail: users.email,
    })
    .from(comments)
    .innerJoin(users, eq(comments.userId, users.id))
    .innerJoin(lessons, eq(comments.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(
      and(
        isNull(comments.parentId),
        isNull(comments.deletedAt),
        ne(comments.userId, currentUserId)
      )
    )
    .get();
}

// A course taught by someone else, so "enrolling" notifies its Instructor.
function findCourse(currentUserId: number) {
  return db
    .select({
      id: courses.id,
      title: courses.title,
      instructorId: users.id,
      instructorName: users.name,
      instructorEmail: users.email,
    })
    .from(courses)
    .innerJoin(users, eq(courses.instructorId, users.id))
    .where(ne(courses.instructorId, currentUserId))
    .get();
}

async function getCurrentUser(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) throw data("Select a user from the DevUI panel", { status: 401 });
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) throw data("Unknown user", { status: 401 });
  return user;
}

async function safe<T>(fn: () => Promise<T>) {
  try {
    return { ok: true as const, value: await fn() };
  } catch (e: any) {
    return { ok: false as const, error: `${e.status ?? ""} ${e.message}` };
  }
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getCurrentUser(request);

  // Identify on every load so the recipient exists before its feed is read.
  await knock.users.update(knockUserId(user.id), recipientFor(user));

  // A second user, to prove a token for one user can't read another's feed.
  const other = db.select().from(users).where(ne(users.id, user.id)).get();

  const preferences = await safe(() =>
    knock.users.getPreferences(knockUserId(user.id), "default")
  );

  return {
    user: { id: user.id, name: user.name, role: user.role },
    knockUserId: knockUserId(user.id),
    otherKnockUserId: other ? knockUserId(other.id) : null,
    userToken: await signTokenFor(user.id),
    ...knockConfig,
    question: findQuestion(user.id) ?? null,
    course: findCourse(user.id) ?? null,
    preferences,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await getCurrentUser(request);
  const intent = String((await request.formData()).get("intent"));
  const actor = recipientFor(user);

  if (intent === "discussion-reply") {
    const q = findQuestion(user.id);
    if (!q) return { intent, result: { ok: false, error: "No question found" } };
    const result = await safe(() =>
      knock.workflows.trigger("discussion-reply", {
        actor,
        recipients: [
          { id: knockUserId(q.authorId), name: q.authorName, email: q.authorEmail },
        ],
        data: {
          lesson_title: q.lessonTitle,
          question_excerpt: q.body.slice(0, 80),
          reply_excerpt: "PROTOTYPE reply from the Knock spike",
          url: `/courses/${q.courseSlug}`,
        },
      })
    );
    return { intent, result };
  }

  if (intent === "new-enrollment") {
    const c = findCourse(user.id);
    if (!c) return { intent, result: { ok: false, error: "No course found" } };
    const result = await safe(() =>
      knock.workflows.trigger("new-enrollment", {
        actor,
        recipients: [
          { id: knockUserId(c.instructorId), name: c.instructorName, email: c.instructorEmail },
        ],
        data: { course_title: c.title },
      })
    );
    return { intent, result };
  }

  if (intent === "opt-in" || intent === "opt-out") {
    const result = await safe(() =>
      knock.users.setPreferences(knockUserId(user.id), "default", {
        __persistence_strategy__: "merge",
        categories: { [ENROLLMENT_CATEGORY]: intent === "opt-in" },
      })
    );
    return { intent, result };
  }

  if (intent === "reset-prefs") {
    const result = await safe(() =>
      knock.users.unsetPreferences(knockUserId(user.id), "default")
    );
    return { intent, result };
  }

  return { intent, result: { ok: false, error: "Unknown intent" } };
}

// ─── Headless feed client: browser → Knock, public key + signed user token ───

type FeedResponse = {
  entries: Array<{
    id: string;
    source: { key: string };
    inserted_at: string;
    seen_at: string | null;
    read_at: string | null;
    blocks: Array<{ name: string; rendered?: string; content?: string }>;
    actors: Array<{ name?: string }>;
  }>;
  meta: { unread_count: number; unseen_count: number; total_count: number };
};

function useKnockApi(publicApiKey: string, userToken: string) {
  return useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(`https://api.knock.app/v1${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${publicApiKey}`,
          "X-Knock-User-Token": userToken,
          "Content-Type": "application/json",
        },
      });
      const body = await res.json().catch(() => null);
      return { status: res.status, body };
    },
    [publicApiKey, userToken]
  );
}

export default function PrototypeKnock({ loaderData }: Route.ComponentProps) {
  const d = loaderData;
  const actionData = useActionData<typeof action>();
  const api = useKnockApi(d.publicApiKey, d.userToken);
  const [feed, setFeed] = useState<{ status: number; body: FeedResponse | any } | null>(null);
  const [crossUser, setCrossUser] = useState<{ status: number; body: any } | null>(null);
  const [lastCall, setLastCall] = useState<{ status: number; body: any } | null>(null);

  const feedPath = (userId: string) =>
    `/users/${userId}/feeds/${d.feedChannelId}?page_size=20`;

  const loadFeed = useCallback(async () => {
    setFeed(await api(feedPath(d.knockUserId)));
  }, [api, d.knockUserId]);

  useEffect(() => {
    loadFeed();
    if (d.otherKnockUserId) api(feedPath(d.otherKnockUserId)).then(setCrossUser);
  }, [loadFeed, d.otherKnockUserId, actionData]);

  const markAll = async (status: "seen" | "read" | "unread") => {
    const ids = (feed?.body?.entries ?? []).map((e: any) => e.id);
    setLastCall(
      await api(`/messages/batch/${status}`, {
        method: "POST",
        body: JSON.stringify({ message_ids: ids }),
      })
    );
    loadFeed();
  };

  const markOne = async (id: string, status: "seen" | "read") => {
    setLastCall(await api(`/messages/${id}/${status}`, { method: "PUT" }));
    loadFeed();
  };

  const entries: FeedResponse["entries"] = feed?.body?.entries ?? [];
  const meta = feed?.body?.meta;
  const enrollmentPref = d.preferences.ok
    ? (d.preferences.value as any).categories?.[ENROLLMENT_CATEGORY]
    : undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 font-mono text-sm">
      <div className="rounded border-2 border-dashed border-amber-500 bg-amber-50 p-3 text-amber-900">
        PROTOTYPE — Knock spike. Throwaway; lives on <code>prototype/knock-spike</code>.
      </div>

      <section className="rounded border p-4">
        <h2 className="mb-2 font-bold">1. Signed user token</h2>
        <p>
          DevUI user: <b>{d.user.name}</b> (id {d.user.id}, {d.user.role}) → Knock
          user <code>{d.knockUserId}</code>
        </p>
        <p className="break-all text-xs text-gray-500">token: {d.userToken.slice(0, 60)}…</p>
        <p>
          Own feed with this token: <b>{feed?.status ?? "…"}</b>
        </p>
        <p>
          Another user's feed (<code>{d.otherKnockUserId}</code>) with this token:{" "}
          <b>{crossUser?.status ?? "…"}</b> {crossUser?.body?.code ?? crossUser?.body?.message}
        </p>
      </section>

      <section className="rounded border p-4">
        <h2 className="mb-2 font-bold">2. Trigger (Node SDK)</h2>
        <Form method="post" className="flex flex-wrap gap-2">
          <button name="intent" value="discussion-reply" className="rounded bg-blue-600 px-3 py-1 text-white">
            Reply to {d.question ? `${d.question.authorName}'s question` : "(no question)"}
          </button>
          <button name="intent" value="new-enrollment" className="rounded bg-blue-600 px-3 py-1 text-white">
            Enroll in {d.course ? `"${d.course.title}" (→ ${d.course.instructorName})` : "(no course)"}
          </button>
        </Form>
        {d.question && (
          <p className="mt-2 text-xs text-gray-500">
            Reply goes to Knock user {d.question.authorId}: switch to {d.question.authorName} in the DevUI to see it.
          </p>
        )}
      </section>

      <section className="rounded border p-4">
        <h2 className="mb-2 font-bold">3. Headless feed API</h2>
        <p>
          unread: <b>{meta?.unread_count ?? "?"}</b> · unseen: <b>{meta?.unseen_count ?? "?"}</b> ·
          total: <b>{meta?.total_count ?? "?"}</b>
        </p>
        <div className="my-2 flex flex-wrap gap-2">
          <button onClick={loadFeed} className="rounded border px-3 py-1">Refresh</button>
          <button onClick={() => markAll("seen")} className="rounded border px-3 py-1">Mark all seen</button>
          <button onClick={() => markAll("read")} className="rounded border px-3 py-1">Mark all read</button>
          <button onClick={() => markAll("unread")} className="rounded border px-3 py-1">Mark all unread</button>
        </div>
        <ul className="space-y-1">
          {entries.map((e) => (
            <li key={e.id} className={`rounded border p-2 ${e.read_at ? "opacity-60" : "bg-blue-50"}`}>
              <div>
                <b>{e.source.key}</b> from {e.actors[0]?.name ?? "?"} ·{" "}
                {e.seen_at ? "seen" : "unseen"} · {e.read_at ? "read" : "unread"}
              </div>
              <div dangerouslySetInnerHTML={{ __html: e.blocks[0]?.rendered ?? "" }} />
              <button onClick={() => markOne(e.id, "seen")} className="mr-2 underline">seen</button>
              <button onClick={() => markOne(e.id, "read")} className="underline">read</button>
            </li>
          ))}
          {entries.length === 0 && <li className="text-gray-500">Feed is empty.</li>}
        </ul>
      </section>

      <section className="rounded border p-4">
        <h2 className="mb-2 font-bold">4. Preferences (new-enrollment, off by default)</h2>
        <p>
          This user's <code>{ENROLLMENT_CATEGORY}</code> preference:{" "}
          <b>{JSON.stringify(enrollmentPref) ?? "unset (falls back to default)"}</b>
        </p>
        <Form method="post" className="my-2 flex flex-wrap gap-2">
          <button name="intent" value="opt-in" className="rounded border px-3 py-1">Opt in</button>
          <button name="intent" value="opt-out" className="rounded border px-3 py-1">Opt out</button>
          <button name="intent" value="reset-prefs" className="rounded border px-3 py-1">Reset to default</button>
        </Form>
      </section>

      <section className="rounded border p-4">
        <h2 className="mb-2 font-bold">State</h2>
        <pre className="overflow-x-auto whitespace-pre-wrap text-xs">
          {JSON.stringify(
            { lastAction: actionData, lastClientCall: lastCall, preferences: d.preferences, feedMeta: meta },
            null,
            2
          )}
        </pre>
      </section>
    </div>
  );
}
