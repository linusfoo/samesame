import { Agent } from "agents";

export type ItemState = { status: "idle" };

export class ItemAgent extends Agent<Env, ItemState> {
  initialState: ItemState = { status: "idle" };
}
