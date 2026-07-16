import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "vf-editor": DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & { "data-theme"?: string },
        HTMLElement
      >;
    }
  }
}
