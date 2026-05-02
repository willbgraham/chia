import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
// Stripe needs the raw body for signature verification, so we cannot
// use the default JSON parser.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "STRIPE_WEBHOOK_SECRET not configured" },
      { status: 500 },
    );
  }

  const sig = request.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 },
    );
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${msg}` },
      { status: 400 },
    );
  }

  // Catch + log all event-handler errors but still return 200 so Stripe
  // doesn't retry indefinitely. Real failures show up in Vercel logs as
  // [stripe webhook] errors and we manually flip the user if needed.
  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "invoice.paid":
      case "invoice_payment.paid": // newer Stripe event variant
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionCancelled(event.data.object as Stripe.Subscription);
        break;
      default:
        // Ignore unrelated events; Stripe keeps retrying only on non-2xx.
        break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(
      `[stripe webhook] event ${event.type} (${event.id}) failed:`,
      msg,
    );
  }

  return NextResponse.json({ received: true });
}

// On checkout completion, the user's UUID arrives via `client_reference_id`
// (we append user.id to the Payment Link URL when sending it). UUIDs are
// URL-safe — phone numbers used to be encoded as %2B which looked ugly
// and caused decoding edge cases.
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const ref = session.client_reference_id?.trim();
  if (!ref) {
    // Some payment links won't carry a reference (e.g. user opened the
    // raw link without the query param). Log and skip rather than 500;
    // we'll match the customer up later via invoice.paid if possible.
    console.warn(
      "[stripe webhook] checkout.session.completed without client_reference_id — skipping",
      { sessionId: session.id, customer: session.customer },
    );
    return;
  }
  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id ?? null;

  const sb = getAdminClient();
  // Try by user UUID first (the new format). Fall back to whatsapp_number
  // for any old payment links that pre-date this change.
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      ref,
    );
  const filterColumn = isUuid ? "id" : "whatsapp_number";

  const { data: user, error } = await sb
    .from("users")
    .update({
      plan: "premium",
      stripe_customer_id: customerId,
      billing_period_start: new Date().toISOString(),
    })
    .eq(filterColumn, ref)
    .select("id, whatsapp_number")
    .single();

  if (error) throw new Error(`User update failed: ${error.message}`);
  if (!user) throw new Error(`No user matching client_reference_id ${ref}`);

  // If the user just upgraded mid-onboarding, advance them out of step 7.
  await advancePostUpgrade(user.id);

  await sendReactivationMessage(user.whatsapp_number);
}

async function advancePostUpgrade(userId: string): Promise<void> {
  try {
    const sb = getAdminClient();
    const { data: state } = await sb
      .from("conversation_state")
      .select("state")
      .eq("user_id", userId)
      .single();
    if (state?.state !== "onboarding_step_7") return;

    const { data: user } = await sb
      .from("users")
      .select("memory_json")
      .eq("id", userId)
      .single();
    const memory =
      (user?.memory_json as { lesson_mode?: string } | null) ?? {};
    const nextState =
      memory.lesson_mode === "free"
        ? "active_free_chat"
        : memory.lesson_mode === "structured" || memory.lesson_mode === "both"
          ? "active_structured_lesson"
          : "active_free_chat";
    await sb
      .from("conversation_state")
      .update({
        state: nextState,
        last_message_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
  } catch (err) {
    console.error("[stripe webhook] advancePostUpgrade error:", err);
  }
}

// Renew billing period each time a subscription invoice is paid so
// audio_usage caps reset monthly. Note: only updates if the user
// already has stripe_customer_id set (from a prior checkout.session.completed).
// If no row matches, we silently skip — this is normal for events that
// arrive before checkout.session.completed (Stripe doesn't guarantee order).
async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const customerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id ?? null;
  if (!customerId) {
    console.warn("[stripe webhook] invoice.paid without customer id — skipping", {
      invoiceId: invoice.id,
    });
    return;
  }

  const sb = getAdminClient();
  const { data, error } = await sb
    .from("users")
    .update({
      plan: "premium",
      billing_period_start: new Date().toISOString(),
    })
    .eq("stripe_customer_id", customerId)
    .select("id");

  if (error) {
    console.error("[stripe webhook] invoice.paid update error:", error.message);
    return;
  }
  if (!data || data.length === 0) {
    // No user row has this customer id yet. Likely the matching
    // checkout.session.completed hasn't been processed yet (or had
    // no client_reference_id). Log so we know to manually reconcile.
    console.warn(
      "[stripe webhook] invoice.paid: no user with stripe_customer_id — needs manual reconciliation",
      { customerId, invoiceId: invoice.id },
    );
  }
}

async function handleSubscriptionCancelled(sub: Stripe.Subscription) {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  const sb = getAdminClient();
  const { error } = await sb
    .from("users")
    .update({ plan: "free" })
    .eq("stripe_customer_id", customerId);

  if (error)
    throw new Error(`Subscription cancellation update failed: ${error.message}`);
}

// After a successful upgrade, send Chia's reactivation message directly
// via Meta WhatsApp Cloud API. Best-effort — the upgrade itself already
// succeeded, so a failure here just means the user doesn't get the
// celebratory message.
async function sendReactivationMessage(whatsappNumber: string) {
  try {
    const { sendText } = await import("@/lib/messaging/whatsapp");
    await sendText(
      whatsappNumber,
      "¡Estás de vuelta! 🎉 Now we can talk as much as we want — including voice practice 🎵 Where were we...? 😊",
    );
  } catch (err) {
    console.error("[stripe webhook] reactivation send failed:", err);
  }
}
