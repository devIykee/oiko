// Runs in <head> before first paint (no flash):
// - theme: localStorage "oiko-theme" = "light" | "dark" | "auto" (default). light/dark set html[data-theme]; auto follows the system.
// - website announcement bar: hidden when previously dismissed.
export const THEME_KEY = "oiko-theme";
export const ANNOUNCE_KEY = "oiko-announce-dismissed";
export const THEME_SCRIPT = `(function(){try{var d=document.documentElement,t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark"){d.setAttribute("data-theme",t)}if(localStorage.getItem("${ANNOUNCE_KEY}")==="1"){d.setAttribute("data-hide-announce","")}}catch(e){}})();`;
