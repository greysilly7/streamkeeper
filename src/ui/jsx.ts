export type AttributeValue = string | number | boolean | null | undefined;
export type Child = Html | string | number | boolean | null | undefined | readonly Child[];
export type HtmlProps = {
  children?: Child;
  key?: string;
  class?: string;
  id?: string;
  lang?: string;
  style?: string;
  title?: string;
  role?: string;
  href?: string;
  target?: string;
  rel?: string;
  type?: string;
  name?: string;
  content?: string;
  charset?: string;
  value?: string | undefined;
  placeholder?: string;
  autocomplete?: string;
  crossorigin?: string | boolean;
  readonly?: boolean;
  required?: boolean;
  checked?: boolean;
  disabled?: boolean;
  for?: string;
  width?: string;
  height?: string;
  viewBox?: string;
  xmlns?: string;
  d?: string;
  fill?: string;
  stroke?: string;
  "stroke-width"?: string;
  "stroke-linecap"?: string;
  "aria-live"?: string;
  "aria-label"?: string;
  "aria-hidden"?: boolean | string;
  "data-host"?: string;
  "data-move"?: string;
  "data-target"?: string;
  "data-modal"?: string;
  [key: `aria-${string}`]: AttributeValue;
  [key: `data-${string}`]: AttributeValue;
};

type Component<Props extends object> = (props: Props) => Html;
type ElementType = string | Component<object>;

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderChild(child: Child): string {
  if (child instanceof Html) return child.value;
  if (Array.isArray(child)) return child.map(renderChild).join("");
  if (child === null || child === undefined || typeof child === "boolean") return "";
  return escapeHtml(String(child));
}

function renderAttributes(props: HtmlProps): string {
  return Object.entries(props)
    .filter(([name]) => name !== "children" && name !== "key")
    .map(([name, value]) => {
      if (value === false || value === null || value === undefined) return "";
      if (value === true) return ` ${name}`;
      return ` ${name}="${escapeHtml(String(value))}"`;
    })
    .join("");
}

export class Html {
  public constructor(public readonly value: string) {}

  public toString(): string {
    return this.value;
  }
}

export function rawHtml(value: string): Html {
  return new Html(value);
}

export function renderHtml(value: Html): string {
  return value.value;
}

export function Fragment(props: { children?: Child }): Html {
  return rawHtml(renderChild(props.children));
}
export function html<Props extends object>(
  tag: (props: Props) => Html,
  props: Props | null,
  ...children: Child[]
): Html;
export function html(tag: string, props: HtmlProps | null, ...children: Child[]): Html;
export function html<Props extends object>(
  tag: ElementType,
  props: Props | HtmlProps | null,
  ...children: Child[]
): Html {
  if (typeof tag === "function") {
    const componentProps = { ...(props ?? {}), children } as Props;
    return tag(componentProps);
  }
  const attributes = renderAttributes((props ?? {}) as HtmlProps);
  const content = children.map(renderChild).join("");
  return rawHtml(VOID_ELEMENTS.has(tag) ? `<${tag}${attributes}>` : `<${tag}${attributes}>${content}</${tag}>`);
}

declare global {
  namespace JSX {
    type Element = Html;
    interface ElementChildrenAttribute {
      children: Child;
    }
    interface IntrinsicElements {
      [tagName: string]: HtmlProps;
    }
  }
}
