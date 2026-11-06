import animations from "./css/animations.css";
import base from "./css/base.css";
import component from "./css/component.css";
import page from "./css/page.css";
import tokens from "./css/tokens.css";

const THEME_CSS = [tokens, animations, base, component, page].join("");

export default THEME_CSS;
