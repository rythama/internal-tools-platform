import type { Decision } from '@itp/core';

export type ApprovalVoteView = {
  voterSub: string;
  vote: 'approve' | 'reject';
  note?: string;
  votedAt: string;
};

export type ApprovalView = {
  approvalId: number;
  action: string;
  resourceType: string;
  resourceId: string;
  state: 'pending' | 'approved' | 'rejected' | 'applied' | 'expired';
  requestedBy: string;
  requestedAt: string;
  requiredApprovals: number;
  votes: ApprovalVoteView[];
};

export type ApprovalPanelProps = {
  approvals: readonly ApprovalView[];
  /** Decided by core, not by the panel: self-approval bans live in the state machine. */
  canVote: (approval: ApprovalView) => Decision;
  endpoint: string;
};

/**
 * Pending approvals with their vote trail. The trail is shown even where the actor
 * cannot vote — "who signed this off" is the question an auditor asks first.
 */
export function ApprovalPanel({ approvals, canVote, endpoint }: ApprovalPanelProps) {
  if (approvals.length === 0) {
    return <p className="muted">No approvals on this record.</p>;
  }

  return (
    <div className="approval-panel">
      {approvals.map((approval) => {
        const decision = canVote(approval);
        const approveVotes = approval.votes.filter((vote) => vote.vote === 'approve').length;
        return (
          <article key={approval.approvalId} className="approval">
            <header>
              <span className={`badge badge-state-${approval.state}`}>{approval.state}</span>
              <strong>{approval.action}</strong>
              <span className="muted">
                requested by {approval.requestedBy} · {approval.requestedAt}
              </span>
              <span className="muted">
                {approveVotes} of {approval.requiredApprovals} approvals
              </span>
            </header>

            <ol className="vote-trail">
              {approval.votes.length === 0 ? <li className="muted">No votes yet.</li> : null}
              {approval.votes.map((vote, index) => (
                <li key={`${vote.voterSub}-${index}`}>
                  <span className={`badge badge-vote-${vote.vote}`}>{vote.vote}</span>
                  <span>{vote.voterSub}</span>
                  <span className="muted">{vote.votedAt}</span>
                  {vote.note ? <span className="note">“{vote.note}”</span> : null}
                </li>
              ))}
            </ol>

            {approval.state === 'pending' ? (
              decision.allowed ? (
                <form className="approval-actions" method="post" action={endpoint}>
                  <input type="hidden" name="approvalId" value={approval.approvalId} />
                  <label className="field">
                    <span>Note</span>
                    <input type="text" name="note" placeholder="Reason (recorded on the chain)" />
                  </label>
                  <button className="btn btn-positive" type="submit" name="vote" value="approve">
                    Approve
                  </button>
                  <button className="btn btn-destructive" type="submit" name="vote" value="reject">
                    Reject
                  </button>
                </form>
              ) : (
                <p className="muted">{decision.reason}</p>
              )
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
