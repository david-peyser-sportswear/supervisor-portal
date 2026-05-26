import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { SupervisorService } from "../gen/mvdev/supervisor_pb";

// The Connect-RPC transport connects to either a local Foundry server or the production MVDev API
const transport = createConnectTransport({
  baseUrl: process.env.NEXT_PUBLIC_MVDEV_API_URL || "http://localhost:5001",
});

export const supervisorClient = createClient(SupervisorService, transport);
