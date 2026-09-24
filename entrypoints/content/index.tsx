import ReactDOM from "react-dom/client";
import { ReaderPlayerRoot } from "./ReaderPlayerRoot";

export default defineContentScript({
  matches: ["<all_urls>"],
  cssInjectionMode: "ui",

  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: "pagereader-widget",
      position: "inline",
      anchor: "body",
      onMount: (container) => {
        const root = ReactDOM.createRoot(container);
        root.render(<ReaderPlayerRoot />);
        return root;
      },
      onRemove: (root) => {
        root?.unmount();
      },
    });

    ui.mount();
  },
});
