import { COACHING_PLANS, type CoachingPlanId } from './coaching-plans.ts';

export type InquiryStatus = 'idle' | 'pending' | 'accepted' | 'provider-error' | 'network-error';
export type InquiryState = Readonly<{ status: InquiryStatus; message: string }>;

export function resolveInquiryCommitment(search: string): CoachingPlanId | '' {
  const values = new URLSearchParams(search).getAll('program');
  if (values.length !== 1) return '';
  return COACHING_PLANS.find(plan => plan.id === values[0])?.id ?? '';
}

const messages: Record<Exclude<InquiryStatus, 'idle'>, string> = {
  pending: 'Submitting your request…',
  accepted: 'Your request has been submitted. A call is confirmed only after we agree a time by email.',
  'provider-error': 'The form service could not accept your request. Check your details and try again, or email me directly. Your entries are still here.',
  'network-error': 'A connection problem means we could not confirm submission. Your entries are still here. Try again, or email me directly.',
};

export function createInquirySubmission(options: {
  action: string;
  send: typeof fetch;
  onState: (state: InquiryState) => void;
}) {
  let status: InquiryStatus = 'idle';
  const update = (next: Exclude<InquiryStatus, 'idle'>) => {
    status = next;
    options.onState({ status, message: messages[next] });
  };

  return {
    async submit(body: FormData): Promise<InquiryStatus> {
      // This guard also covers Enter and scripted submit events while waiting.
      if (status === 'pending' || status === 'accepted') return status;
      update('pending');
      let response: Response;
      try {
        response = await options.send(options.action, {
          method: 'POST',
          body,
          headers: { Accept: 'application/json' },
          credentials: 'omit',
          redirect: 'error',
        });
      } catch {
        // A failed connection does not establish whether the service received it.
        update('network-error');
        return status;
      }
      update(response.ok ? 'accepted' : 'provider-error');
      return status;
    },
  };
}
