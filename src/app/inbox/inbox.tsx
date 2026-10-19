"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCalendarDate, HOUSE_TIME_ZONE } from "@/lib/dish-calendar";
import { reviewSummary } from "@/lib/dish-reviews";
import type { DishSubmission, DishVote, HouseNotification, Roommate } from "@/lib/types";
import { HouseArt } from "@/components/house-art";
import { MemberMenu } from "@/components/member-menu";
import { Avatar } from "@/app/dishes/avatar";
import { DishPhoto } from "./review-photo";
import { voteDishReview } from "./actions";
import styles from "./inbox.module.css";

type InboxData = {
  notifications: HouseNotification[];
  submissions: DishSubmission[];
  votes: DishVote[];
  people: Roommate[];
  count: number;
  sentCount: number;
  unreadCount: number;
};

export default function Inbox({ member, initialReview }: { member: Roommate; initialReview: string | null }) {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<InboxData | null>(null);
  const [error, setError] = useState("");
  const [needsSetup, setNeedsSetup] = useState(false);
  const [tab, setTab] = useState<"inbox" | "sent">("inbox");
  const [onlyToVote, setOnlyToVote] = useState(false);
  const [selected, setSelected] = useState(initialReview);
  const [revision, setRevision] = useState(0);
  const [limit, setLimit] = useState(50);
  const [pending, startTransition] = useTransition();
  const [voteError, setVoteError] = useState("");
  const [notice, setNotice] = useState("");
  const voting = useRef(false);

  useEffect(() => {
    let active = true;
    let loading = false;
    const controller = new AbortController();
    async function load() {
      if (loading || voting.current) return;
      loading = true;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
      try {
        const [notifications, sent, people, unread] = await Promise.all([
          supabase.from("house_notifications").select("*", { count: "exact" }).eq("recipient_id", member.id)
            .order("created_at", { ascending: false }).order("id").limit(limit).abortSignal(signal),
          supabase.from("dish_submissions").select("*", { count: "exact" }).eq("roommate_id", member.id)
            .order("created_at", { ascending: false }).order("id").limit(limit).abortSignal(signal),
          supabase.from("roommates").select("id,name,color,created_at").order("name").abortSignal(signal),
          supabase.from("house_notifications").select("id", { count: "exact", head: true }).eq("recipient_id", member.id).is("read_at", null).abortSignal(signal),
        ]);
        if (notifications.error || sent.error || people.error || unread.error) throw notifications.error ?? sent.error ?? people.error ?? unread.error;
        const ids = [...new Set([...(notifications.data ?? []).map((item) => item.submission_id), ...(sent.data ?? []).map((item) => item.id), ...(initialReview ? [initialReview] : [])])];
        const [submissions, votes] = ids.length ? await Promise.all([
          supabase.from("dish_submissions").select("*").in("id", ids).abortSignal(signal),
          supabase.from("dish_votes").select("*").in("submission_id", ids).abortSignal(signal),
        ]) : [{ data: [], error: null }, { data: [], error: null }];
        if (submissions.error || votes.error) throw submissions.error ?? votes.error;
        if (active) {
          setData({ notifications: notifications.data ?? [], submissions: submissions.data ?? [], votes: votes.data ?? [], people: people.data ?? [], count: notifications.count ?? 0, sentCount: sent.count ?? 0, unreadCount: unread.count ?? 0 });
          setError(""); setNeedsSetup(false);
        }
      } catch (caught) {
        if (active) {
          const code = caught && typeof caught === "object" && "code" in caught ? caught.code : "";
          setNeedsSetup(code === "PGRST205" || code === "42P01");
          setError("Your inbox couldn’t refresh. Check your connection and try again.");
        }
      } finally { loading = false; }
    }
    void load();
    function refresh() { if (document.visibilityState === "visible") void load(); }
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    return () => { active = false; controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [supabase, member.id, revision, limit, initialReview]);

  const submissions = data?.submissions ?? [];
  const votes = data?.votes ?? [];
  const people = data?.people ?? [];
  const nameOf = (id: string) => people.find((person) => person.id === id)?.name ?? "A housemate";
  const notifications = data?.notifications ?? [];
  const requests = notifications.map((notification) => ({ notification, submission: submissions.find((item) => item.id === notification.submission_id) }))
    .filter((item): item is { notification: HouseNotification; submission: DishSubmission } => Boolean(item.submission));
  const rows = tab === "sent"
    ? submissions.filter((item) => item.roommate_id === member.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).map((submission) => ({ submission, notification: null }))
    : requests.filter((item) => !onlyToVote || reviewSummary(item.submission, votes, member.id).canVote);
  const selectedSubmission = submissions.find((item) => item.id === selected) ?? rows[0]?.submission;
  const summary = selectedSubmission ? reviewSummary(selectedSubmission, votes, member.id) : null;
  const unread = data?.unreadCount ?? 0;
  const awaitingVote = requests.filter((item) => reviewSummary(item.submission, votes, member.id).canVote).length;

  async function markRead(notification?: HouseNotification | null) {
    if (!notification || notification.read_at) return;
    const readAt = new Date().toISOString();
    try {
      const { error } = await supabase.from("house_notifications").update({ read_at: readAt }).eq("id", notification.id).abortSignal(AbortSignal.timeout(10_000));
      if (error) throw error;
      setData((previous) => previous ? { ...previous, unreadCount: Math.max(0, previous.unreadCount - (previous.notifications.some((item) => item.id === notification.id && !item.read_at) ? 1 : 0)), notifications: previous.notifications.map((item) => item.id === notification.id ? { ...item, read_at: readAt } : item) } : previous);
      window.dispatchEvent(new Event("house-inbox-changed"));
    } catch { setVoteError("Couldn’t mark this message read. Your review is still available."); }
  }

  function selectReview(submission: DishSubmission, notification?: HouseNotification | null) {
    if (pending) return;
    setSelected(submission.id); setVoteError(""); setNotice("");
    void markRead(notification);
    if (window.matchMedia("(max-width: 760px)").matches) window.requestAnimationFrame(() => document.getElementById("review-detail")?.scrollIntoView({ behavior: "auto", block: "start" }));
  }

  function vote(approved: boolean) {
    if (!selectedSubmission || !summary?.canVote || voting.current) return;
    const id = selectedSubmission.id;
    voting.current = true;
    setVoteError(""); setNotice("");
    startTransition(async () => {
      try {
        const result = await voteDishReview(id, approved);
        if (!result.ok) { setVoteError(result.error); return; }
        const submission = result.submission;
        setData((previous) => previous ? { ...previous,
          submissions: previous.submissions.map((item) => item.id === id ? { ...submission, photo_deleted_at: result.photoRemoved ? new Date().toISOString() : submission.photo_deleted_at } : item),
          votes: [...previous.votes.filter((item) => !(item.submission_id === id && item.voter_id === member.id)), { submission_id: id, voter_id: member.id, approved, created_at: new Date().toISOString() }],
        } : previous);
        setNotice(submission.status === "approved" ? "Three approvals. The day is green and the points are in."
          : submission.status === "rejected" ? "Three rejections. The submitter can wash up and try again."
            : `Your ${approved ? "approval" : "rejection"} is in. Thanks for checking.`);
        void markRead(notifications.find((item) => item.submission_id === id));
        window.dispatchEvent(new Event("house-inbox-changed"));
      } catch { setVoteError("Your vote couldn’t be confirmed. Refresh the review before trying again."); }
      finally { voting.current = false; setRevision((value) => value + 1); }
    });
  }

  return <main className={styles.page}><div className={styles.shell}>
    <nav className={styles.nav} aria-label="House navigation"><Link href="/" className={styles.brand}><HouseArt name="house" size={38} />albion<span>/ the house</span></Link><div className={styles.navActions}><Link href="/dishes">Dish duty</Link><MemberMenu member={member} /></div></nav>
    <header className={styles.header}><div><p className={styles.eyebrow}>A LITTLE HOUSEKEEPING</p><h1>Your inbox<span>.</span></h1><p>Clean sinks deserve a second look. Help the house keep it fair.</p></div><HouseArt name="shared" size={100} /></header>
    <div className={styles.rule}><HouseArt name="camera" size={38} /><p><strong>Five housemates. One quick vote.</strong> Three approvals count the wash; three rejections invite another try. Photos are deleted after the decision.</p></div>
    <div className={styles.toolbar}><div className={styles.tabs} role="group" aria-label="Inbox view"><button aria-pressed={tab === "inbox"} onClick={() => { setTab("inbox"); setSelected(null); setVoteError(""); }}>Inbox{unread > 0 && <span>{unread} unread</span>}</button><button aria-pressed={tab === "sent"} onClick={() => { setTab("sent"); setSelected(null); setVoteError(""); }}>Your submissions</button></div><button className={styles.refresh} disabled={pending} onClick={() => setRevision((value) => value + 1)}>Refresh inbox</button></div>
    {needsSetup ? <div className={styles.error} role="status"><strong>One quick setup step</strong><p>Run <code>supabase/migrations/0004_dish_reviews.sql</code> in the Supabase SQL editor, then refresh your inbox.</p></div> : error ? <p className={styles.error} role="alert">{error}</p> : null}
    <div className={styles.workspace}>
      <aside className={styles.messages} aria-label={tab === "sent" ? "Your submissions" : "House messages"}>
        {tab === "inbox" && <label className={styles.filter}><input type="checkbox" checked={onlyToVote} onChange={(event) => { setOnlyToVote(event.target.checked); setSelected(null); }} />Needs your vote <span>{awaitingVote}</span></label>}
        {!data && !error ? <p className={styles.listEmpty} role="status">Opening the house inbox…</p> : rows.length === 0 ? <div className={styles.listEmpty}><HouseArt name="clean-sink" size={72} /><strong>{onlyToVote ? data && data.count > limit ? "These messages are checked." : "All caught up." : tab === "sent" ? "A clean slate." : "No house mail yet."}</strong><p>{onlyToVote && data && data.count > limit ? "Load older messages to check for more requests." : tab === "sent" ? "Your dish submissions will appear here." : "New dish photos and review results will land here."}</p></div> : <ul>{rows.map(({ submission, notification }) => <li key={submission.id}><button className={`${styles.message} ${selectedSubmission?.id === submission.id ? styles.selected : ""}`} onClick={() => selectReview(submission, notification)} disabled={pending} aria-pressed={selectedSubmission?.id === submission.id}><div className={styles.messageTop}><Avatar name={nameOf(submission.roommate_id)} /><strong>{nameOf(submission.roommate_id)}</strong>{notification && !notification.read_at && <span className={styles.unreadDot} aria-label="Unread" />}</div><p>{notification?.kind === "approved" ? "Your wash was approved" : notification?.kind === "rejected" ? "Your wash needs another try" : tab === "sent" ? "Your dish check-in" : "A clean sink to check"}</p><div className={styles.messageBottom}><span>{formatCalendarDate(submission.performed_on, { month: "short", day: "numeric" })}</span><span className={`${styles.status} ${styles[submission.status]}`}>{submission.status === "pending" ? "In review" : submission.status === "approved" ? "Approved" : "Try again"}</span></div></button></li>)}</ul>}
        {data && (tab === "sent" ? data.sentCount : data.count) > limit && <button className={styles.loadMore} onClick={() => setLimit((value) => value + 50)}>Load older messages</button>}
      </aside>
      <section id="review-detail" className={styles.detail} aria-label="Dish review" aria-busy={pending}>
        {!selectedSubmission || !summary ? <div className={styles.emptyDetail}><HouseArt name="dishes" size={130} /><h2>A little teamwork goes a long way.</h2><p>Open a message to review a photo or see how your wash is doing.</p><Link href="/dishes">Back to dish duty</Link></div> : <>
          <div className={styles.detailHeading}><div><p className={styles.eyebrow}>THE SINK CHECK</p><h2>{formatCalendarDate(selectedSubmission.performed_on, { weekday: "long", month: "long", day: "numeric" })}</h2><p>Washed by <strong>{nameOf(selectedSubmission.roommate_id)}</strong> · submitted {new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: HOUSE_TIME_ZONE }).format(new Date(selectedSubmission.created_at))}</p></div><span className={`${styles.status} ${styles[selectedSubmission.status]}`}>{selectedSubmission.status === "pending" ? "In review" : selectedSubmission.status === "approved" ? "Approved" : "Needs another try"}</span></div>
          {selectedSubmission.status === "pending" ? <DishPhoto photoPath={selectedSubmission.photo_path} /> : <div className={styles.closedReview}><HouseArt name={selectedSubmission.status === "approved" ? "clean-sink" : "dishes"} size={92} /><h3>{selectedSubmission.status === "approved" ? "The house says: all clean." : "One more reset, please."}</h3><p>{selectedSubmission.photo_deleted_at ? "The review photo has been deleted." : "Voting is closed. The photo is queued for removal."}</p>{selectedSubmission.status === "rejected" && selectedSubmission.roommate_id === member.id && <Link href="/dishes">Head back to the calendar to submit a fresh photo.</Link>}</div>}
          <div className={styles.tally}><div><strong>{summary.approvals}<small> / 3</small></strong><span>Approvals</span></div><div><strong>{summary.rejections}<small> / 3</small></strong><span>Rejections</span></div><p>{selectedSubmission.status === "pending" ? "First to three decides." : "Review complete."}</p></div>
          {summary.canVote ? <div className={styles.voteArea}><p>Does the photo show a clean sink and finished dishes?</p><div><button className={styles.approveButton} disabled={pending} onClick={() => vote(true)}>{pending ? "Saving vote…" : "Approve wash"}</button><button className={styles.rejectButton} disabled={pending} onClick={() => vote(false)}>Needs another wash</button></div><small>One vote each. Votes are final.</small></div> : selectedSubmission.status === "pending" ? <p className={styles.waiting}>{selectedSubmission.roommate_id === member.id ? "Your photo is with the other five members. You can’t vote on your own wash." : `You voted ${summary.myVote ? "approve" : "needs another wash"}. Waiting for the rest of the house.`}</p> : null}
          <div className={styles.ballots}><h3>House votes</h3><ul>{people.filter((person) => person.id !== selectedSubmission.roommate_id).map((person) => { const ballot = votes.find((item) => item.submission_id === selectedSubmission.id && item.voter_id === person.id); return <li key={person.id}><Avatar name={person.name} /><span>{person.name}</span><small>{ballot ? ballot.approved ? "Approved" : "Another wash" : selectedSubmission.status === "pending" ? "Not voted yet" : "Didn’t vote"}</small></li>; })}</ul></div>
          <p className={styles.notice} role="status" aria-live="polite">{notice}</p>{voteError && <p className={styles.error} role="alert">{voteError}</p>}
        </>}
      </section>
    </div><footer className={styles.footer}>Only the house can see these reviews. Points use submission time, in Toronto.</footer>
  </div></main>;
}
