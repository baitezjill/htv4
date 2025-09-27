import * as React from "react" ;

declare module "react-window"  {
  export interface ListChildComponentProps  {
    index: number ;
    style: React.CSSProperties ;
    data?: any ;
  }

  export interface VariableSizeListHandle extends React.Component<any>  {
    resetAfterIndex(index: number, shouldForceUpdate?: boolean): void ;
    scrollToItem(index: number, align?: "auto" | "start" | "center" | "end"): void ;
    scrollTo(offset: number): void ;
    // Non-public ref exposed by implementation; use guardedly
    _outerRef?: HTMLElement | null ;
  }

  export class VariableSizeList extends React.Component<any > {
    resetAfterIndex(index: number, shouldForceUpdate?: boolean): void ;
    scrollToItem(index: number, align?: "auto" | "start" | "center" | "end"): void ;
    scrollTo(offset: number): void ;
  }

  export class FixedSizeList extends React.Component<any > {
    resetAfterIndex(index: number, shouldForceUpdate?: boolean): void ;
    scrollToItem(index: number, align?: "auto" | "start" | "center" | "end"): void ;
    scrollTo(offset: number): void ;
  }
}

// Also cover the compiled/dist paths that TS may resolve to under Bundler moduleResolution
// so imports like 'react-window/dist/index.cjs.js' are recognized.
declare module "react-window/dist/index.cjs" {
  export * from "react-window";
  const _default: any;
  export default _default;
}

declare module "react-window/dist/index.cjs.js" {
  export * from "react-window";
  const _default: any;
  export default _default;
}

// Wildcard fallback for any nested paths
declare module "react-window/*" {
  export * from "react-window";
  const _default: any;
  export default _default;
}