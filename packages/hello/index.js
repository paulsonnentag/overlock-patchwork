import { greet } from "./greet.js";

export const message = greet("overlock");
export const greetings = ["world", "automerge", "blobs"].map(greet);
