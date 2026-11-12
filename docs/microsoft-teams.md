# Microsoft Teams personal chats

OpenBot includes an optional Microsoft Teams gateway for one registered bot and personal chats. The gateway uses Microsoft's Teams SDK to authenticate incoming Bot Connector activities and the bot's OAuth connection to obtain a delegated Microsoft Graph token. It calls `GET /me?$select=id` and signs a short-lived proof only when the Graph user ID matches the sender ID in that Teams activity. OpenBot verifies the proof and the exact message body before processing it.

This does not grant access to group chats, channels, meetings, or users who are not current members of the configured OpenBot team. A user must also have chat access to the selected bot and link their OpenBot team membership once. The link command is consumed by OpenBot and is never sent to the model. Messages run with Ask permissions.

## Register Microsoft resources

1. Register a Microsoft Entra application and an Azure Bot using the same application ID and tenant. Create a client secret and configure the bot's Teams channel.
2. Add a Bot OAuth connection for that application. Use the connection name configured below, enable Microsoft Graph delegated `User.Read`, and grant the required tenant consent.
3. Add the bot to a Teams app manifest with personal scope enabled. Configure its messaging endpoint as `https://<gateway-host>/api/messages` and make the app available to the intended users.
4. Deploy the OpenBot server and gateway on separate services or processes. The Teams SDK keeps sign-in flow state in process memory, so run one gateway replica unless you configure shared state in the SDK.

The Microsoft tenant administrator must approve any consent or Teams app policy required by that tenant. A real tenant, bot registration, and user consent are not provisioned by this repository.

## Configure OpenBot

Set these variables on the OpenBot server before starting it:

| Variable | Meaning |
| --- | --- |
| `OMB_TEAMS_ENABLED` | Set to `1` to enable; any other value leaves the integration off. |
| `OMB_TEAMS_APP_ID` | Microsoft bot application GUID. |
| `OMB_TEAMS_TENANT_ID` | Allowed Microsoft Entra tenant GUID. |
| `OMB_TEAMS_BOT_ID` | Existing OpenBot bot ID that receives the messages. |
| `OMB_TEAMS_RECIPIENT_ID` | Teams activity recipient ID registered for this bot. |
| `OMB_TEAMS_GATEWAY_KEY` | Base64url encoding of 32 random bytes, shared only with the gateway. |
| `OMB_TEAMS_CLIENT_SECRET` | Microsoft bot app secret used by OpenBot to send replies through Bot Connector. |
| `OMB_TEAMS_SERVICE_ORIGINS` | Comma-separated exact HTTPS origins allowed for Connector replies, such as `https://smba.trafficmanager.net`; include only origins used by the tenant. |

The server rejects incomplete or malformed configuration and keeps the gateway key and client secret out of the model process environment. Keep both values in a deployment secret store and out of logs and source control.

## Run the gateway

Set these variables in the gateway process. Use the same app ID, tenant ID, recipient ID, client secret, and gateway key as the OpenBot server:

| Variable | Meaning |
| --- | --- |
| `OMB_TEAMS_APP_ID` | Microsoft bot application GUID. |
| `OMB_TEAMS_TENANT_ID` | Allowed Microsoft Entra tenant GUID. |
| `OMB_TEAMS_RECIPIENT_ID` | Teams activity recipient ID for the configured bot. |
| `OMB_TEAMS_CLIENT_SECRET` | Microsoft bot app secret used by the Teams SDK to validate and answer activities. |
| `OMB_TEAMS_GATEWAY_KEY` | Same 32-byte base64url secret configured on OpenBot. |
| `OMB_TEAMS_OAUTH_CONNECTION` | Exact Azure Bot OAuth connection name configured with delegated `User.Read`. |
| `OMB_TEAMS_OPENBOT_URL` | OpenBot origin, for example `https://openbot.example.com`; HTTPS is required except for loopback development. |
| `OMB_TEAMS_GATEWAY_PORT` | Optional listen port; defaults to `3978`. |

Start the service with `pnpm teams-gateway`. Expose the gateway's `/api/messages` endpoint to Microsoft Teams over HTTPS. The OpenBot origin must also be reachable by the gateway over HTTPS. The gateway obtains the current process epoch from OpenBot over this protected connection; it does not require manually copying the epoch after server restarts.

On the first message, Teams prompts the user to sign in with the Microsoft account used in Teams. The OAuth flow gets a delegated Graph token. If Graph reports a different user ID from the Teams activity, the gateway refuses to forward the message. After successful sign-in, send the message again.

## Link an OpenBot team member

An authenticated current team member calls `POST /api/microsoft-teams/link` in OpenBot Settings to get a short-lived, one-time secret, then sends `/openbot-link <secret>` to the bot in a personal Teams chat. The secret links that Teams identity to the signed-in team member; it is not sent to the model. Use `DELETE /api/microsoft-teams/link` to revoke the link. The APIs act on the signed-in member, not an email supplied by the caller.

OpenBot keeps per-member Teams conversations separate, deduplicates incoming activity IDs, and checks current membership, link status, bot access, and conversation ownership again before sending a reply. A delivery timeout can leave the result unknown, so OpenBot does not retry a message automatically.

## Verification limits

The repository tests use isolated temporary OpenBot fixtures and mocked Microsoft Graph/Connector responses. They verify proof signing, identity mismatch rejection, relay authorization, account linking, access checks, and reply handling. They do not exercise a real Microsoft tenant, Azure Bot OAuth connection, Graph consent, Teams client, or production network deployment. Configure and verify those with a test tenant before enabling the integration for a team.
