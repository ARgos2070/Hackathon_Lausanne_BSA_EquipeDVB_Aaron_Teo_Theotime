import { relay } from "@/lib/server/relay";

// JSON-RPC relay to the Candide paymaster. Rules are in lib/server/relay.ts.
export function POST(request: Request) {
  return relay(request, "paymaster");
}
