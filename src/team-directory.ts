import { defineIdFamily } from "@fungi.computer/cairn/id";

export const requestIds = defineIdFamily({
  family: "tourtois-browser-request",
  version: 1,
  kinds: { request: { prefix: "request" } },
});
