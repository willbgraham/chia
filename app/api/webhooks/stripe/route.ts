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

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "invoice.paid":
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
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// On checkout completion, the user's WhatsApp number arrives via
// `client_reference_id` (the Make scenario appends it to the
// Payment Link URL when it sends the link to the student).
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const whatsapp = session.client_reference_id?.trim();
  if (!whatsapp) {
    throw new Error(
      "checkout.session.completed missing client_reference_id (whatsapp_number)",
    );
  }
  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id ?? null;

  const sb = getAdminClient();
  const { data: user, error } = await sb
    .from("users")
    .update({
      plan: "premium",
      stripe_customer_id: customerId,
      billing_period_start: new Date().toISOString(),
    })
    .eq("whatsapp_number", whatsapp)
    .select("id")
    .single();

  if (error) throw new Error(`User update failed: ${error.message}`);
  if (!user) throw new Error(`No user with whatsapp_number ${whatsapp}`);

  await sendReactivationMessage(whatsapp);
}

// Renew billing period each time a subscription invoice is paid so
// audio_usage caps reset monthly.
async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const customerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id ?? null;
  if (!customerId) return;

  const sb = getAdminClient();
  const { error } = await sb
    .from("users")
    .update({
      plan: "premium",
      billing_period_start: new Date().toISOString(),
    })
    .eq("stripe_customer_id", customerId);

  if (error) throw new Error(`Invoice paid update failed: ${error.message}`);
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
