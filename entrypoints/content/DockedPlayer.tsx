import { ReaderPlayer, ReaderPlayerProps } from "./ReaderPlayer";

export function DockedPlayer(props: Omit<ReaderPlayerProps, "mode">) {
  return <ReaderPlayer mode="docked" {...props} />;
}
