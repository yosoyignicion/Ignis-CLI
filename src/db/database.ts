import { DatabaseSync } from "node:sqlite";

export const ignisState = new DatabaseSync("ignis_state.db");
