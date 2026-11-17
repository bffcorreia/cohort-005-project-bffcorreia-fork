// PROTOTYPE — throwaway Knock spike for "Does Knock hold up against Cadence?".
// Lives on the prototype/knock-spike branch only. Never merge.
import { Knock, signUserToken } from "@knocklabs/node";

if (!process.env.KNOCK_API_KEY) process.loadEnvFile(".env");

export const knock = new Knock();

export const knockConfig = {
  publicApiKey: process.env.KNOCK_PUBLIC_API_KEY!,
  feedChannelId: process.env.KNOCK_FEED_CHANNEL_ID!,
};

export function knockUserId(userId: number) {
  return String(userId);
}

export function signTokenFor(userId: number) {
  return signUserToken(knockUserId(userId), { expiresInSeconds: 3600 });
}
