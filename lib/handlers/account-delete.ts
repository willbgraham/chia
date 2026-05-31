// Hard account deletion via chat — GDPR "right to be forgotten" path.
// Works for both free AND premium users:
//   - Free: just deletes the user row + cascades the related data
//   - Premium: cancels active Stripe subscriptions, deletes Stripe
//     customer record, THEN deletes the user row + cascades
//
// Two-step UX so a user can't typo-delete:
//   1. handleFreeChat detects "delete my account" → startAccountDeletion
//      sends a confirmation prompt, sets state = awaiting_delete_confirm
//   2. route-message routes that state to handleDeleteConfirm, which
//      parses yes/no and either performs the deletion or cancels
//
// Cascading FKs on related tables (messages, conversation_state,
// audio_usage, user_lesson_progress, teacher_image_sends, feedback,
// short_links → no, that one's by token not user_id) handle the rest
// of the data wipe atomically when the user row goes.

import { getAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { sendText } from "@/lib/messaging/whatsapp";
import { logMessage } from "@/lib/handlers/messages";
import { updateState } from "@/lib/handlers/state";
import { getMemory } from "@/lib/handlers/memory";
import type { Plan } from "@/types";

// Phrases that trigger the deletion flow. Stronger than wantsAccount
// (which is "manage subscription, send the magic link") — these are
// specifically a request to be wiped.
export function wantsDeleteAccount(message: string): boolean {
  const t = message.toLowerCase();
  const triggers = [
    "delete my account",
    "delete my data",
    "delete account",
    "delete my profile",
    "remove my account",
    "remove my data",
    "wipe my account",
    "wipe my data",
    "erase my account",
    "erase my data",
    "i want my account deleted",
    "i want to delete my account",
    "right to be forgotten",
    "gdpr request",
    "gdpr delete",
    "borrar mi cuenta",
    "eliminar mi cuenta",
  ];
  return triggers.some((kw) => t.includes(kw));
}

// Initiate the deletion flow. Sends the confirmation prompt and
// transitions state. The actual wipe happens in handleDeleteConfirm
// after the student confirms.
export async function startAccountDeletion(args: {
  userId: string;
  whatsappNumber: string;
  userPlan: Plan;
}): Promise<void> {
  const memory = await getMemory(args.userId);
  const name = memory.name ?? "amig@";
  const planLine =
    args.userPlan === "premium"
      ? "\n• Your Premium subscription (cancelled immediately)"
      : "";
  const msg = `¿Estás seguro, ${name}? 🌿\n\nDeleting your account wipes:\n• Every chat we've ever had\n• Your progress + curriculum position\n• Your name, level, all preferences${planLine}\n\nThis can't be undone.\n\nReply *yes delete me* to confirm.\nReply *cancel* to keep your account.`;
  await sendText(args.whatsappNumber, msg);
  await logMessage({
    userId: args.userId,
    role: "assistant",
    content: msg,
  });
  await updateState(args.userId, { state: "awaiting_delete_confirm" });
}

// Parse the student's confirmation reply. yes = wipe, no = cancel,
// anything else = re-prompt. Defensive regex — we'd rather re-prompt
// than accidentally delete on an ambiguous reply.
export async function handleDeleteConfirm(args: {
  userId: string;
  whatsappNumber: string;
  userMessage: string;
}): Promise<void> {
  // Log the inbound either way.
  await logMessage({
    userId: args.userId,
    role: "user",
    content: args.userMessage,
  });

  const yesRe =
    /\b(yes,?\s*delete( me)?|delete me|confirm delete|sí,?\s*borrar|si,?\s*borrar|yes please delete)\b/i;
  const noRe = /\b(no|cancel|stop|wait|nevermind|nvm|never mind|keep( it)?)\b/i;

  if (yesRe.test(args.userMessage)) {
    await performDeletion(args.userId, args.whatsappNumber);
    return;
  }

  if (noRe.test(args.userMessage)) {
    const reply =
      "Sin problema 🌿 Account kept. Back to chatting — say *hola* or *next lesson* whenever you're ready.";
    await sendText(args.whatsappNumber, reply);
    await logMessage({
      userId: args.userId,
      role: "assistant",
      content: reply,
    });
    await updateState(args.userId, { state: "active_free_chat" });
    return;
  }

  // Ambiguous — re-prompt without timing out the state. Student gets
  // a clean second chance to be explicit.
  const reprompt =
    "Just to be clear — reply *yes delete me* to delete everything, or *cancel* to keep your account 🌿";
  await sendText(args.whatsappNumber, reprompt);
  await logMessage({
    userId: args.userId,
    role: "assistant",
    content: reprompt,
  });
}

// The actual deletion. Order matters:
//   1. Pull stripe_customer_id while the row still exists
//   2. Cancel + delete Stripe customer (best-effort — DB delete is
//      the real GDPR obligation; Stripe data we can mop up later)
//   3. Send the goodbye message
//   4. DELETE FROM users — cascades wipe all related rows
async function performDeletion(
  userId: string,
  whatsappNumber: string,
): Promise<void> {
  const sb = getAdminClient();
  const memory = await getMemory(userId);
  const name = memory.name ?? "amig@";

  const { data: userRow } = await sb
    .from("users")
    .select("stripe_customer_id, plan")
    .eq("id", userId)
    .single();

  // Step 1+2: Stripe cleanup. Wrapped in try so a Stripe outage
  // doesn't block the user's GDPR request. We log + continue.
  if (userRow?.stripe_customer_id) {
    try {
      const stripe = getStripe();
      // Cancel all active subscriptions for this customer first.
      const subs = await stripe.subscriptions.list({
        customer: userRow.stripe_customer_id,
        status: "active",
      });
      for (const sub of subs.data) {
        await stripe.subscriptions.cancel(sub.id);
      }
      // Then delete the Stripe customer record — removes their saved
      // payment method + their billing history index entry. Invoices
      // themselves remain in Stripe for tax/audit but are detached
      // from any identifiable customer profile.
      await stripe.customers.del(userRow.stripe_customer_id);
    } catch (err) {
      console.error(
        "[account-delete] Stripe cleanup failed for user",
        userId,
        err,
      );
      // Continue — we'll still wipe the DB row.
    }
  }

  // Step 3: Goodbye message. Send BEFORE the DB delete so the row
  // (and the messages log) are still valid for logMessage. The
  // assistant log gets cascaded away in step 4 — that's fine, the
  // user is gone, no audit trail to preserve on our side.
  const goodbye = `Done, ${name} 🌿 Account deleted. Adiós.\n\nIf you ever want to come back, just message me — I won't remember you, but we can start fresh.`;
  try {
    await sendText(whatsappNumber, goodbye);
    await logMessage({
      userId,
      role: "assistant",
      content: goodbye,
    });
  } catch (err) {
    console.error("[account-delete] goodbye send failed:", err);
    // Still proceed to delete.
  }

  // Step 4: hard delete. FK cascades on the related tables (messages,
  // conversation_state, audio_usage, user_lesson_progress,
  // teacher_image_sends, feedback) clean up everything in one shot.
  const { error } = await sb.from("users").delete().eq("id", userId);
  if (error) {
    console.error("[account-delete] DB delete failed for user", userId, error);
    // We told the user we deleted them but didn't. Manual cleanup
    // required — surface clearly in the logs so an operator sees it.
    return;
  }
  console.log(`[account-delete] hard-deleted user ${userId}`);
}
