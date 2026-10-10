// SERVER ONLY. Supabase access with the service_role key (CDC.md, sections 4 and 7.6).
// Never import this file from a client component: the key must not reach the browser.
//
// This database holds public data only: Safe addresses, passkey public keys and the
// sponsorship log. No private key, no recovery phrase, no Swissquote client identity.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getAddress } from "viem";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

let client: SupabaseClient | undefined;

export function db(): SupabaseClient {
  client ??= createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export const SPONSORED_OPS_PER_ACCOUNT_PER_DAY = 20;
export const ACCOUNT_CREATIONS_PER_IP_PER_HOUR = 5;

const HOUR_MS = 60 * 60 * 1000;

export async function isRegisteredAccount(address: string): Promise<boolean> {
  const { data, error } = await db()
    .from("accounts")
    .select("address")
    .eq("address", getAddress(address))
    .maybeSingle();
  if (error) throw new Error(`accounts lookup failed: ${error.message}`);
  return data !== null;
}

export async function countRecentCreations(ip: string): Promise<number> {
  const { count, error } = await db()
    .from("accounts")
    .select("address", { count: "exact", head: true })
    .eq("created_ip", ip)
    .gte("created_at", new Date(Date.now() - HOUR_MS).toISOString());
  if (error) throw new Error(`accounts count failed: ${error.message}`);
  return count ?? 0;
}

export async function insertAccount(row: {
  address: string;
  credential_id: string;
  pubkey_x: string;
  pubkey_y: string;
  created_ip: string;
}): Promise<void> {
  const { error } = await db().from("accounts").insert(row);
  if (error) throw new Error(`accounts insert failed: ${error.message}`);
}

// Sponsored operations of the last 24 hours for one account.
export async function countRecentSponsorships(address: string): Promise<number> {
  const { count, error } = await db()
    .from("sponsorship_log")
    .select("id", { count: "exact", head: true })
    .eq("address", getAddress(address))
    .gte("created_at", new Date(Date.now() - 24 * HOUR_MS).toISOString());
  if (error) throw new Error(`sponsorship_log count failed: ${error.message}`);
  return count ?? 0;
}

export async function logSponsorship(address: string): Promise<void> {
  const { error } = await db().from("sponsorship_log").insert({ address: getAddress(address) });
  if (error) throw new Error(`sponsorship_log insert failed: ${error.message}`);
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}
