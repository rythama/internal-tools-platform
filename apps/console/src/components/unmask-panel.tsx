'use client';

/**
 * The reviewer's side of unmask-with-reason: state a reason, see the value once.
 *
 * A client component only because it needs the action's return value — the revealed
 * fields come back in the response and are rendered here, never put in a URL, a cookie
 * or the page's initial HTML. Nothing is decided here: the server action re-derives the
 * actor, requires the reason, and lets core enforce policy, grant and audit.
 */
import { useActionState } from 'react';
import { revealKycCase, type UnmaskState } from '../tools/kyc-unmask';
import { MIN_UNMASK_REASON_LENGTH } from '../tools/kyc-review';

const LABELS: Readonly<Record<string, string>> = {
  dateOfBirth: 'Date of birth',
  taxId: 'Tax ID',
  documentUrl: 'Document',
};

export function UnmaskPanel({ caseId }: { caseId: string }) {
  const [state, submit, pending] = useActionState<UnmaskState, FormData>(revealKycCase, {
    status: 'idle',
  });

  return (
    <div className="unmask-panel">
      <h3>Unmask PII</h3>
      <p className="muted">
        Date of birth and tax ID are redacted for everyone by default. Seeing them is a
        separate action, recorded on the audit chain with the reason you give.
      </p>

      <form action={submit}>
        <input type="hidden" name="caseId" value={caseId} />
        <label htmlFor="unmask-reason">Reason</label>
        <textarea
          id="unmask-reason"
          name="reason"
          rows={2}
          minLength={MIN_UNMASK_REASON_LENGTH}
          required
          placeholder="e.g. Verifying tax ID against the submitted document for case review"
        />
        <button type="submit" className="btn btn-neutral" disabled={pending}>
          {pending ? 'Requesting…' : 'Request unmask'}
        </button>
      </form>

      {state.status === 'denied' ? <p className="flash flash-error">Denied: {state.message}</p> : null}

      {state.status === 'revealed' ? (
        <>
          <p className="flash">Unmasked and recorded on the audit chain.</p>
          <dl className="unmasked">
            {Object.entries(state.fields).map(([field, value]) => (
              <div key={field} className="detail-row">
                <dt>{LABELS[field] ?? field}</dt>
                <dd className="value">{value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
    </div>
  );
}
