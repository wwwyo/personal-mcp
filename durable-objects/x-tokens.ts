import { defineDurableObject } from "void/durable";
import { XTokenStore } from "../src/x-token-store.ts";

// X の token と bookmarks の既読を持つ Durable Object。
// Void はこのファイルから binding X_TOKENS とクラス XTokensDurableObject を作る。
// name と、src/server.ts が使うインスタンス名 "default" を変えると保存済みの状態を失う。
export const XTokens = defineDurableObject({
  name: "x-tokens",
  class: XTokenStore,
});
export default XTokens;
