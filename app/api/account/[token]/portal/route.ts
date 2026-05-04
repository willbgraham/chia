// Generate a Stripe Customer Portal session for a verified account
// token. Called from the "Manage subscription" button on
// /account/<token>. Stripe portal handles cancellation, payment
// method updates, invoice history — all hosted by Stripe so we
// never touch credit-card data.

import { NextResponse, type NextRequest } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getAdminClient } from "@/lib/supabase/admin";
import { verifyAccountToken } from "@/lib/account/magic-link";
import type { User } from "@/types";

export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: { token: string } },
) {
  const verified = verifyAccountToken(params.token);
  if (!verified) {
    return NextResponse.json(
      { error: "expired or invalid link" },
      { status: 401 },
    );
  }

  const sb = getAdminClient();
  const { data: user } = await sb
    .from("users")
    .select("*")
    .eq("id", verified.userId)
    .single();
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }
  const u = user as User;
  if (!u.stripe_customer_id) {
    // Free user with no Stripe customer record yet — they have
    // nothing to manage. Front-end shouldn't show them this button,
    // but guard anyway.
    return NextResponse.json(
      { error: "you're on the free plan — nothing to manage yet" },
      { status: 400 },
    );
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://chiachat.com";
  const returnUrl = `${baseUrl.replace(/\/+$/, "")}/account/${params.token}`;

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: u.stripe_customer_id,
      return_url: returnUrl,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[portal] stripe error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "stripe error" },
      { status: 500 },
    );
  }
}
