import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { SupervisorService } from "../gen/mvdev/supervisor_pb";

const transport = createConnectTransport({
  baseUrl: process.env.NEXT_PUBLIC_MVDEV_API_URL || "https://foundry.dpeyserapps.com",
  interceptors: [
    (next) => async (req) => {
      const token = process.env.NEXT_PUBLIC_INTERFACES_AUTH_TOKEN;
      if (token) {
        req.header.set("Authorization", `Bearer ${token}`);
      }
      return await next(req);
    },
  ],
});

export const supervisorClient = createClient(SupervisorService, transport);
