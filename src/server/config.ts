export function clerkKeys() {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!!publishableKey !== !!secretKey) throw new Error("Configure both Clerk keys together.");
  return publishableKey && secretKey ? { publishableKey, secretKey } : null;
}
