/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare namespace JSX {
  interface IntrinsicElements {
    // HTML elements
    html: any;
    head: any;
    body: any;
    main: any;
    div: any;
    span: any;
    button: any;
    section: any;
    h1: any;
    h2: any;
    h3: any;
    p: any;
    a: any;
    img: any;
    iframe: any;
    style: any;
    script: any;
    link: any;
    meta: any;
    title: any;
    noscript: any;
    slot: any;
    form: any;
    input: any;
    ul: any;
    li: any;
    
    // Custom elements
    'lite-youtube': {
      videoid: string;
      style?: string;
      params?: string;
      children?: any;
    };
  }
}