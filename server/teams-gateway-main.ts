import { teamsGatewayConfig } from "./teams/gateway-config.ts";
import { startTeamsGateway } from "./teams/gateway-app.ts";

const config = teamsGatewayConfig(process.env);
delete process.env.OMB_TEAMS_GATEWAY_KEY;
delete process.env.OMB_TEAMS_CLIENT_SECRET;
const gateway = await startTeamsGateway(config);
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await gateway.close();
};
process.once("SIGINT", () => { void close().finally(() => process.exit(0)); });
process.once("SIGTERM", () => { void close().finally(() => process.exit(0)); });
