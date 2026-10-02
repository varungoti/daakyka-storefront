import { BrevoEnableButton } from "@/components/admin/brevo-enable-button";
import { BrevoTestSend } from "@/components/admin/brevo-test-send";

/**
 * F-267: what sits under the Brevo credentials form once Brevo is
 * configured (an API key AND a From Email).
 *
 * - The "Send test email to me" button is there in BOTH states. The main
 *   setup path auto-enables Brevo the moment the second field is saved, so
 *   the owner who follows it never sees the "email is OFF" callout; if the
 *   test button lived only inside that callout, the end-to-end check
 *   would exist only for the owner who skipped the normal flow, and the one
 *   who followed it would be left with "Test connection" (which pings
 *   Brevo's account endpoint and sends nothing).
 * - The amber "email sending is OFF" callout and its "Turn on email" button
 *   appear only while the toggle is off, because that is the only state in
 *   which there is anything to turn on.
 *
 * Plain composition of the two client buttons, so it renders on the server
 * and is covered by a markup test (tests/integration/integrations-enabled.test.ts).
 */
export function BrevoSetupActions({
  configured,
  enabled,
  waitingEmails,
}: {
  /** Brevo has an API key and a From Email (getIntegrationStatuses). */
  configured: boolean;
  /** The Brevo toggle (IntegrationSetting.enabled) is on. */
  enabled: boolean;
  /** Queued emails that go out the moment email is turned on. */
  waitingEmails: number;
}) {
  if (!configured) return null;

  if (enabled) {
    return (
      <div
        className="mt-3 space-y-2 rounded-2xl border border-border bg-surface p-4 text-xs text-muted"
        data-testid="brevo-test-panel"
      >
        <p>
          Email is on. Send yourself a test to confirm Brevo accepts your key and From Email end to
          end — it goes to your own admin address.
        </p>
        <BrevoTestSend />
      </div>
    );
  }

  return (
    <div
      className="mt-3 space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900"
      data-testid="brevo-off-callout"
    >
      <p className="font-semibold">Your key is saved, but email sending is OFF.</p>
      <p>
        Brevo shows as configured, but the provider toggle above is still disabled, so no email is
        being sent — order and sign-up emails wait in a queue instead.
        {waitingEmails > 0
          ? ` ${waitingEmails} queued email${waitingEmails === 1 ? " is" : "s are"} waiting and will go out as soon as you turn it on.`
          : ""}{" "}
        Send yourself a test first, then turn it on:
      </p>
      <div className="flex flex-wrap items-start gap-3">
        <BrevoTestSend />
        <BrevoEnableButton waitingEmails={waitingEmails} />
      </div>
    </div>
  );
}
