import { ReaderPlayer, ReaderPlayerProps } from "./ReaderPlayer";

export function FloatingWidget(props: Omit<ReaderPlayerProps, "mode">) {
  return <ReaderPlayer mode="floating" {...props} />;
}
