import type { DishSubmission, DishVote } from "./types";

export const REVIEW_MAJORITY = 3;

export function reviewSummary(submission: DishSubmission, votes: DishVote[], memberId: string) {
  const ballots = votes.filter((vote) => vote.submission_id === submission.id);
  const myVote = ballots.find((vote) => vote.voter_id === memberId);
  return {
    approvals: ballots.filter((vote) => vote.approved).length,
    rejections: ballots.filter((vote) => !vote.approved).length,
    myVote: myVote ? myVote.approved : null,
    canVote: submission.status === "pending" && submission.roommate_id !== memberId && !myVote,
  };
}
