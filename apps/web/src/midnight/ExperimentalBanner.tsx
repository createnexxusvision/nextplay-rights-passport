import { useState } from "react";
import { NETWORK_ID } from "./config";

const VARIANTS = {
  mainnet: { tone: "banner-danger", msg: "MAINNET · This application has not been audited. Don't use it to hold valuable assets or sign binding agreements.", dismissible: false },
  preview: { tone: "banner-gold", msg: "Testnet Preview · Experimental build. Blockchain actions may reset and are not production-ready.", dismissible: true },
  preprod: { tone: "banner-gold", msg: "Testnet Preprod · Experimental build. Blockchain actions may reset and are not production-ready.", dismissible: true },
  undeployed: { tone: "banner-slate", msg: "Local dev chain · Not real value. Experimental build.", dismissible: true },
} as const;

const KEY = `nextplay-banner-dismissed-${NETWORK_ID}`;
// Storage can throw (private mode, blocked site data): the banner must still render.
const wasDismissed = () => {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

export function ExperimentalBanner() {
  const v = VARIANTS[NETWORK_ID];
  const [hidden, setHidden] = useState(() => v.dismissible && wasDismissed());
  if (hidden) return null;
  return (
    <div role="alert" className={`banner ${v.tone}`}>
      <span>{v.msg}</span>
      {v.dismissible && (
        <button
          type="button"
          className="banner-dismiss"
          onClick={() => {
            try {
              sessionStorage.setItem(KEY, "1");
            } catch {
              /* still hide for this page view */
            }
            setHidden(true);
          }}
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
