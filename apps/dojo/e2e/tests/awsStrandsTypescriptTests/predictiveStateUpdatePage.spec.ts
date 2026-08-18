import { test, expect } from "../../test-isolation-helper";
import { PredictiveStateUpdatesPage } from "../../pages/awsStrandsPages/PredictiveStateUpdatesPage";

// Predictive state updates for AWS Strands (TypeScript). `write_document` is a
// FRONTEND tool, and the demo's predict-state mapping tells the browser that its
// `document` argument feeds the `document` state key.
//
// The first test asserts the mapping on the wire, because the DOM cannot tell the
// feature apart from its absence: the demo republishes the finished document
// anyway, so an editor-only assertion passes with the mapping deleted (confirmed
// by deleting it). The wire is where the difference lives.
//
// The second test covers the decision the dialog gates, through the agent's reply.
//
// Neither test asserts the editor's contents, and that is a limitation rather
// than a preference. The shared page writes text into the editor only while the
// run is still marked as running, and when the last state update lands in the
// same tick as the run finishing, nothing is written and the page then publishes
// the empty editor back into agent state, so the document is lost rather than
// late. That fails roughly one run in three and predates these demos, so it is
// filed separately instead of being papered over with a longer wait. The
// confirm dialog is asserted instead: it gates a halted frontend tool, so it
// cannot be missed by a fast run.
//
// Observed red before shipping: with the predict-state mapping removed from the
// demo config the FIRST test fails at "a PredictState custom event naming
// write_document must reach the wire". The second test still passes without it,
// deliberately: its subject is the decision round-trip, which the authoritative
// snapshot alone can drive. The mapping's own guarantee lives in test one.
const PAGE_URL = "/aws-strands-typescript/feature/predictive_state_updates";
const FIRST_REQUEST =
  "Give me a story for a dragon called Atlantis in document";
const SECOND_REQUEST = "Change dragon name to Lola";

test.describe("Predictive State Updates Feature", () => {
  test("[StrandsTS] maps streaming tool arguments onto document state", async ({
    page,
  }) => {
    const predictive = new PredictiveStateUpdatesPage(page);

    await page.goto(PAGE_URL);
    await predictive.awaitChatReady();

    // Capture before sending: the run starts on the click.
    const ssePromise = predictive.captureRuntimeSSE(
      "aws-strands-typescript",
      "dragon called Atlantis",
    );

    await predictive.sendMessage(FIRST_REQUEST);

    // The proposed change is waiting on the user, which is the halt this feature
    // paints during.
    await expect(predictive.confirmModal).toBeVisible({ timeout: 30_000 });

    // The mapping reached the browser ahead of the arguments it describes, and
    // those arguments streamed in pieces. Both are required for the editor to
    // paint progressively rather than in one jump at the end.
    predictive.assertPredictStatePrecedesArgs(
      await ssePromise,
      "write_document",
      "document",
      "document",
    );

    // Answered rather than walked away from: an unanswered frontend tool leaves
    // the agent's thread waiting on a result that never comes.
    await predictive.approveChanges();
    await predictive.awaitConfirmDismissed();
  });

  test("[StrandsTS] carries a rejected edit back to the agent", async ({
    page,
  }) => {
    const predictive = new PredictiveStateUpdatesPage(page);

    await page.goto(PAGE_URL);
    await predictive.awaitChatReady();

    await predictive.sendMessage(FIRST_REQUEST);
    await expect(predictive.confirmModal).toBeVisible({ timeout: 30_000 });
    await predictive.approveChanges();
    await predictive.awaitConfirmDismissed();

    // A second turn proposes an edit to the document the first turn wrote, so
    // this dialog is the one whose rejection is under test.
    await predictive.sendMessage(SECOND_REQUEST);
    await expect(predictive.confirmModal).toBeVisible({ timeout: 30_000 });

    // The frontend tool's result is what carries the rejection back, and the
    // agent's answer is what proves it landed: the demo's reply differs on a
    // rejected edit, so an approval reaching the agent instead would fail here.
    await predictive.rejectChanges();
    await predictive.awaitConfirmDismissed();
    await expect(predictive.assistantMessages.last()).toContainText(
      /discarded that edit/i,
      { timeout: 30_000 },
    );
  });
});
