# Hosted in-app notification providers for Cadence

Research for [#5](https://github.com/bffcorreia/cohort-005-project-bffcorreia-fork/issues/5) (part of map [#4](https://github.com/bffcorreia/cohort-005-project-bffcorreia-fork/issues/4)).
All sources accessed **2026-11-16**. I used primary sources only (vendor pricing pages and official docs). Pricing pages change often, so re-check them before committing. **⚠** marks a claim I could not fully confirm.

This document compares and ranks the providers. It does not choose one; that is left to a later grilling session.

## Criteria recap

- **Must:** hosted SaaS; free or cheap at low-thousands of users, with known pricing as the number of Students grows; no data-residency constraint.
- **Nice:** a React inbox (stylable, with a headless option); more channels later (email/push); can use our existing Postmark account for email; digest/batching.

All five providers are hosted SaaS and none forces a data region. Novu and Courier also offer EU residency as an option.

## Pricing at a glance

| Provider | Free tier | First paid step | Overage | Billing unit |
| --- | --- | --- | --- | --- |
| **Knock** | 10,000 messages/mo; no hard cap (Knock contacts you about billing the next month) | Starter $250/mo, 50,000 messages | $0.005/message | One message = one user on one channel. Feed retention unlimited on all plans. |
| **Novu Cloud** | 10,000 workflow runs/mo; 5 workflows; unlimited subscribers; 24h activity-log retention | Pro from $30/mo, 30K+ runs, 20 workflows | $1.20 per 1,000 runs | One workflow run (an in-app step and an email step in the same run count once ⚠). Team plan $250/mo. |
| **MagicBell** | Builder: 1,000 deliveries/mo, unlimited users | Startup $249/mo, 50,000 deliveries | $0.0025/delivery | One delivery per user per channel (100 in-app + 50 email = 150). |
| **Courier** | Developer: 10,000 sends/mo | Business: pay-as-you-go, $0.005/send from the first send (50K sends = $250) | $0.005/send | One send = one template to one recipient, across all channels. Digest & batching appear **only in the Enterprise list** ⚠. |
| **SuprSend** | 10,000 notifications/mo, SuprSend branding, no hard stop | Essentials $100/mo, 50,000 notifications | $2 per 1,000 (Essentials); $5 per 1,000 (Business $250/mo) | Per notification. **Batching/digest and User Preferences are listed on Business ($250) and up** ⚠. |

Sources:
- Knock: https://knock.app/pricing
- Novu: https://novu.co/pricing
- MagicBell: https://www.magicbell.com/pricing
- Courier: https://www.courier.com/pricing
- SuprSend: https://www.suprsend.com/pricing

## Feature comparison

| | Knock | Novu Cloud | MagicBell | Courier | SuprSend |
| --- | --- | --- | --- | --- | --- |
| **React inbox** | `@knocklabs/react`: `NotificationFeedPopover`, `NotificationFeed`, `NotificationIconButton` | `@novu/react`: `<Inbox/>`, `Bell`, `Notifications`, `Preferences` | `@magicbell/react`: `Inbox`, `FloatingInbox`, `UserPreferences`, toasts | `@trycourier/courier-react` (v9): `CourierInbox`, toasts, preferences | `@suprsend/react`: drop-in `Inbox`, toasts |
| **Styling** | `--rnf-*` CSS variables, `rnf-` classes, `renderItem`/`renderHeader`, dark mode | Style overrides, sub-component and icon replacement | Importable CSS, class names, `--magicbell-*` variables | `CourierInboxTheme`, custom views | Customization options, custom `notificationComponent` |
| **Headless** | Yes (React hooks, `@knocklabs/client`) | Yes (`useNotifications`, `useCounts`, `@novu/js`) | Partly ⚠ (JS client `magicbell-js`; the React docs list no hooks) | Yes (`useCourier`, courier-js) | Yes (`@suprsend/react-core`: `useFeedClient`, `useFeedData`) |
| **Server trigger** | Node SDK ([knock-node](https://github.com/knocklabs/knock-node)): `workflows.trigger`, or REST trigger endpoint | `@novu/api`: `novu.trigger({ workflowId, to, payload })` | REST `POST /v2/broadcasts` (up to 1,000 recipients); `magicbell-js` ProjectClient | `@trycourier/courier`: `client.send.message(...)`, `POST /send` | `@suprsend/node-sdk`: `workflows.trigger(new WorkflowTriggerRequest(...))` |
| **Recipient identity / sync** | User id string, or a full recipient object identified inline in the trigger (id, email, preferences…); also an identify API | `subscriberId`, created inline in `to` or on the first Inbox session | `external_id` / `email` in each broadcast recipient; `users.saveUser` | `user_id` plus a profile (`profiles.create`); the profile must hold channel data or the send is UNROUTABLE | `distinct_id`, pre-synced or defined inline in `recipients` (`$email`, `$channels`…) |
| **Read / archive state** | `seen_at`, `read_at`, `interacted_at`, `archived_at`; mark all read | read, seen, archived, snoozed; `readAll`, `archiveAll`, `archiveAllRead`, unarchive | `read_at`, `seen_at`, archived; archive, unarchive, archive all | read/unread, opened, clicked, archive, unarchive, `archiveRead`, `archiveAll` | seen, read/unread, archived, interacted; `markAllAsRead`; server-side Messages API |
| **Real-time** | Knock real-time socket service (protocol not documented); cross-tab BroadcastChannel option | WebSocket (`ws.novu.co`, PartySocket on cloud); events such as `notification_received` and `unread_count_changed` | WebSocket realtime client in `magicbell-js` | WebSocket (`inbox.listenForUpdates()`; JWT validated before the socket opens) | socket.io (`initializeSocketConnection`) |
| **Client auth** | Public key; production should use "enhanced security mode" with an RS256 user JWT signed by our server | HMAC `subscriberHash` (Novu says it is required in production) | User JWT generated by our server | Short-lived JWT from `POST /auth/issue-token` with scopes; the SDK does not refresh it | Signed JWT user token (replaced HMAC) |
| **Per-user preferences** | Workflow, category, channel-type and channel levels; env/tenant defaults; hosted or custom preference center | Workflow × channel, built into the Inbox `Preferences` | `UserPreferences` component (category × channel) | Preference center by topic and channel | Yes, **but listed on the Business tier** ⚠ |
| **Digest / batching** | Batch function: fixed or sliding window, batch key, up to 90 days; no plan gate found | Digest step (regular or scheduled, digest key); **max window by plan: Free 1 day, Pro 7 days, Team 30 days** | **Not found** in the docs ⚠ (only bulk API) | Automation digests (collector plus release); pricing lists "Digest & batching" under Enterprise ⚠ | Batch & digest, **Business tier** ⚠ |
| **Postmark as email channel** | Yes (API key + from address; message stream override) | Yes (server API token + from address) | **Not listed** (SES, Mailgun, SendGrid, SMTP, Ping). Postmark over SMTP may work ⚠ | Yes (server token + from address; MessageStream override; failover) | Yes (server token; webhook back to SuprSend for status) |
| **Other channels later** | Email, SMS, push, chat (unlimited channels) | Email, in-app, SMS, chat, push | Email, push, web push, Slack… | Email, SMS, push, chat, in-app | Email, SMS, WhatsApp, push, Slack, Teams… |

### Sources by provider

**Knock**
- https://docs.knock.app/in-app-ui/react/overview
- https://docs.knock.app/in-app-ui/react/feed
- https://docs.knock.app/in-app-ui/security-and-authentication
- https://docs.knock.app/send-notifications/message-statuses
- https://docs.knock.app/send-notifications/triggering-workflows/api
- https://docs.knock.app/preferences/overview
- https://docs.knock.app/designing-workflows/batch-function
- https://docs.knock.app/integrations/email/postmark
- https://docs.knock.app/developer-tools/sdks

**Novu**
- https://docs.novu.co/platform/inbox/overview
- https://docs.novu.co/platform/sdks/react/hooks/use-notifications
- https://docs.novu.co/platform/sdks/javascript
- https://docs.novu.co/platform/inbox/headless-mode
- https://docs.novu.co/platform/sdks/server/typescript
- https://docs.novu.co/platform/workflow/add-and-configure-steps/configure-action-steps/digest
- https://docs.novu.co/platform/integrations/email/postmark

**MagicBell**
- https://www.magicbell.com/docs/libraries/magicbell-react
- https://www.magicbell.com/docs/libraries/magicbell-js
- https://www.magicbell.com/docs/primitive/broadcast
- https://www.magicbell.com/docs/primitive/notification
- https://www.magicbell.com/docs/channels/email

**Courier**
- https://www.courier.com/docs/platform/inbox/inbox-overview
- https://courier.com/docs/platform/inbox/authentication
- https://www.courier.com/docs/sdk-libraries/courier-js-web
- https://www.courier.com/docs/sdk-libraries/node
- https://www.courier.com/docs/platform/automations/digest
- https://www.courier.com/docs/integrations/email/postmark

**SuprSend**
- https://docs.suprsend.com/docs/inbox-react
- https://docs.suprsend.com/docs/react-headless
- https://docs.suprsend.com/docs/js-inapp-feed
- https://docs.suprsend.com/docs/node-trigger-workflow-from-api
- https://docs.suprsend.com/docs/postmark

## Fit for Cadence (ranked, not decided)

The ranking assumes v1 is in-app only, with low-thousands of users and roughly one in-app message per event.

1. **Knock.** It covers every nice-to-have on the free tier: React feed plus hooks, batching, a full preference model, and Postmark. The free tier holds 10K messages, feed retention is unlimited, and there is no hard cap. Its data model is the most mature: recipients can be identified inline in the trigger, and every engagement state is supported. **Trade-off:** the first paid step is steep, $250/mo for 50K messages.
2. **Novu Cloud.** It also covers every nice-to-have: drop-in `<Inbox/>` with built-in preferences, headless hooks, digest, and Postmark. It has the **cheapest growth path**: Pro from $30/mo, then $1.20 per 1K runs. It is open source, so self-hosting stays possible as an exit. **Trade-offs:** the free tier allows only 5 workflows (the v1 catalogue across four roles may exceed that, so count first), digest windows are capped at 1 day on Free, and activity logs are kept for 24h on Free. HMAC is needed in production.
3. **Courier.** It has a good inbox, real-time over WebSocket, JWT auth, Postmark, and a 10K free tier. Pay-as-you-go at $0.005/send scales smoothly. **Trade-off:** the pricing page lists digest & batching only under Enterprise ⚠, which affects the planned digest follow-up.
4. **SuprSend.** It has a 10K free tier, a solid feed SDK (socket.io), and Postmark support. **Trade-off:** per its pricing page, preferences and digest require the $250/mo Business tier ⚠. Essentials ($100) is cheap but lacks both.
5. **MagicBell.** Its free tier is the smallest (1K deliveries/mo, probably too small even for v1). It has no documented digest, and Postmark is not among its listed email providers. Strong inbox and preferences components do not make up for those gaps.

**Not evaluated:** Engagespot (its pricing page returned 404, so free-tier limits could not be confirmed from a primary source).

## Open questions and uncertainties

- **Novu:** what exactly counts as a workflow run, and whether inbox, preferences and digest are on Free (the pricing table did not extract cleanly; the digest docs confirm digest exists with a 1-day limit on Free). Also how long Free keeps inbox message history, as opposed to activity-log retention.
- **Knock:** whether a batched notification counts as one message, and what the real-time transport is (the docs say only "socket").
- **Courier:** whether the automation digest really requires Enterprise or is only highlighted there.
- **SuprSend:** the pricing tick-marks did not render; confirm that preferences and digest are absent below Business.
- **MagicBell:** whether Postmark works over SMTP; whether any digest feature exists.
- **All:** each provider becomes the source of truth for feed state. Whether Cadence also stores notifications is still open in map #4.
