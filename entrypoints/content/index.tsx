import ReactDOM from "react-dom/client";
import { FloatingWidget } from "./FloatingWidget";

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
        root.render(<FloatingWidget />);
        return root;
      },
      onRemove: (root) => {
        root?.unmount();
      },
    });

    ui.mount();
  },
});
